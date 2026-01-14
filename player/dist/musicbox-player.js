#!/usr/bin/env node

// src/audio/AudioEngine.ts
import { spawn, execSync } from "child_process";
import { existsSync } from "fs";
var AudioEngine = class {
  audioProcess = null;
  completionCallbacks = [];
  amplifierPin = 22;
  // GPIO 22 for MAX98357A SD pin
  gpioAvailable = false;
  currentVolume = 10;
  // Default volume percentage (0-100)
  constructor() {
    this.initializeGPIO();
    this.initializeVolume();
  }
  /**
   * Initialize volume control
   */
  initializeVolume() {
    try {
      this.detectVolumeControl();
      this.tryAmixerVolume(this.currentVolume, true);
      console.log(`   \u{1F50A} Volume control initialized (${this.currentVolume}%)`);
    } catch (err) {
      console.log(`   \u26A0\uFE0F  Volume control not available`);
    }
  }
  /**
   * Detect available volume control method
   * Uses ALSA amixer (softvol) for embedded systems
   */
  volumeAvailable = false;
  detectVolumeControl() {
    try {
      execSync("amixer --version", { stdio: "pipe" });
      this.volumeAvailable = true;
      console.log(`   \u{1F50A} Using ALSA volume control`);
    } catch {
      console.log(`   \u26A0\uFE0F  Volume control unavailable - amixer not found`);
      console.log(`      Install alsa-utils for volume control`);
    }
  }
  /**
   * Initialize GPIO control for MAX98357A shutdown pin
   * Uses libgpiod (gpioset) instead of deprecated sysfs interface
   */
  initializeGPIO() {
    try {
      if (!existsSync("/dev/gpiochip0")) {
        return;
      }
      try {
        execSync("gpioset --version", { stdio: "pipe" });
      } catch {
        console.log(`   \u26A0\uFE0F  gpioset not found - amplifier control disabled`);
        console.log(`   PATH: ${process.env.PATH}`);
        return;
      }
      this.setAmplifier(false);
      this.gpioAvailable = true;
      console.log(
        `   \u{1F50C} MAX98357A shutdown control initialized (GPIO ${this.amplifierPin})`
      );
    } catch (err) {
      console.log(`   \u26A0\uFE0F  GPIO control not available - amplifier always on`);
    }
  }
  /**
   * Control MAX98357A shutdown pin using libgpiod
   * @param enabled - true = amplifier on (SD HIGH), false = amplifier off (SD LOW)
   */
  setAmplifier(enabled) {
    if (!this.gpioAvailable) return;
    try {
      const value = enabled ? "1" : "0";
      execSync(`gpioset -c 0 -t 0 ${this.amplifierPin}=${value}`);
    } catch (err) {
    }
  }
  /**
   * Play audio from a stream URL
   * @param streamUrl - The URL to stream from
   * @param metadata - Song metadata for logging
   */
  play(streamUrl, metadata) {
    this.stop();
    this.enableAmplifierAndPlay(streamUrl, metadata);
  }
  /**
   * Enable amplifier with stabilization delay, then start playback
   */
  async enableAmplifierAndPlay(streamUrl, metadata) {
    this.setAmplifier(true);
    await this.sleep(50);
    console.log(`   \u{1F50A} Streaming audio... (volume: ${this.currentVolume}%)`);
    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-fflags",
      "nobuffer"
    ];
    if (!this.volumeAvailable) {
      const volumeMultiplier = this.currentVolume / 100;
      ffplayArgs.push("-af", `volume=${volumeMultiplier}`);
    }
    ffplayArgs.push(streamUrl);
    try {
      this.audioProcess = spawn("ffplay", ffplayArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false
      });
      this.audioProcess.on("error", (err) => {
        console.log(`   \u26A0\uFE0F  ffplay error: ${err.message}`);
        console.log(`      Install ffmpeg for audio playback`);
      });
      this.audioProcess.on("exit", (code) => {
        if (this.audioProcess) {
          this.audioProcess = null;
          setTimeout(() => {
            if (!this.audioProcess) {
              this.setAmplifier(false);
            }
          }, 50);
          if (code === 0) {
            console.log(`
\u2705 Finished playing: ${metadata.title}`);
            this.completionCallbacks.forEach((cb) => cb());
          }
        }
      });
    } catch (err) {
      console.log(`   \u26A0\uFE0F  Failed to start ffplay`);
      console.log(`      Install ffmpeg for audio playback`);
      this.setAmplifier(false);
    }
  }
  /**
   * Stop the currently playing audio
   */
  stop() {
    if (this.audioProcess) {
      try {
        this.audioProcess.kill("SIGKILL");
      } catch (err) {
      }
      this.audioProcess = null;
      setTimeout(() => {
        if (!this.audioProcess) {
          this.setAmplifier(false);
        }
      }, 50);
    } else {
      this.setAmplifier(false);
    }
  }
  /**
   * Check if audio is currently playing
   */
  isPlaying() {
    return this.audioProcess !== null;
  }
  /**
   * Register a callback to be called when audio playback completes
   * @param callback - Function to call on completion
   */
  onComplete(callback) {
    this.completionCallbacks.push(callback);
  }
  /**
   * Set volume level - applies immediately to current and future playback
   * @param percent - Volume level 0-100
   */
  setVolume(percent) {
    percent = Math.max(0, Math.min(100, percent));
    this.currentVolume = percent;
    if (this.volumeAvailable) {
      this.tryAmixerVolume(percent);
    }
  }
  /**
   * Try setting volume via ALSA amixer
   */
  tryAmixerVolume(percent, silent = false) {
    const controls = ["Master", "PCM", "Speaker", "Headphone"];
    for (const control of controls) {
      try {
        execSync(`amixer -q sset ${control} ${percent}%`, { stdio: "pipe" });
        if (!silent) {
          console.log(`\u{1F50A} Volume: ${percent}%`);
        }
        return;
      } catch {
      }
    }
    if (!silent) {
      console.log(`\u26A0\uFE0F  ALSA volume control failed`);
    }
  }
  /**
   * Get current volume level
   * @returns Volume percentage 0-100
   */
  getVolume() {
    return this.currentVolume;
  }
  /**
   * Increase volume by amount
   * @param amount - Amount to increase (default: 10)
   */
  volumeUp(amount = 10) {
    this.setVolume(this.currentVolume + amount);
  }
  /**
   * Decrease volume by amount
   * @param amount - Amount to decrease (default: 10)
   */
  volumeDown(amount = 10) {
    this.setVolume(this.currentVolume - amount);
  }
  /**
   * Play a startup chime to indicate the player is ready
   * Uses speaker-test to generate a pleasant ascending arpeggio
   */
  async playStartupChime() {
    this.setAmplifier(true);
    const notes = [
      { freq: 523, duration: 120 },
      // C5
      { freq: 659, duration: 120 },
      // E5
      { freq: 784, duration: 120 },
      // G5
      { freq: 1047, duration: 200 }
      // C6 (hold longer)
    ];
    try {
      for (const note of notes) {
        await this.playTone(note.freq, note.duration);
        await this.sleep(30);
      }
      this.setVolume(this.currentVolume);
    } catch (err) {
      console.log(`   \u26A0\uFE0F  Startup chime failed`);
    }
    if (!this.isPlaying()) {
      this.setAmplifier(false);
    }
  }
  /**
   * Play a single tone using speaker-test
   */
  playTone(frequency, durationMs) {
    return new Promise((resolve) => {
      const proc = spawn(
        "speaker-test",
        ["-t", "sine", "-f", frequency.toString(), "-c", "2", "-l", "1"],
        { stdio: "ignore" }
      );
      setTimeout(() => {
        proc.kill("SIGTERM");
        resolve();
      }, durationMs);
      proc.on("exit", () => resolve());
      proc.on("error", () => resolve());
    });
  }
  /**
   * Simple sleep helper
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

// src/core/PlayerCore.ts
var PlayerCore = class {
  state;
  audioEngine;
  serverClient;
  constructor(serverClient, audioEngine) {
    this.serverClient = serverClient;
    this.audioEngine = audioEngine || new AudioEngine();
    this.state = this.initialState();
    this.audioEngine.onComplete(() => this.handleAudioComplete());
  }
  /**
   * Initialize the player and play startup chime
   */
  async initialize() {
    await this.audioEngine.playStartupChime();
    console.log("\u{1F3B5} Player ready!");
  }
  initialState() {
    return {
      currentSong: null,
      playlist: [],
      playlistIndex: 0,
      isPlaying: false
    };
  }
  /**
   * Handle an NFC card scan
   * @param nfcId - The NFC card ID that was scanned
   */
  async handleCardScan(nfcId) {
    try {
      console.log(`
\u{1F50D} Scanning card: ${nfcId}`);
      const result = await this.serverClient.scanCard(nfcId);
      if (result.content?.type === "song") {
        const song = result.content.song;
        console.log(`\u{1F3B5} Playing song: ${song.title}`);
        if (song.artist) console.log(`   Artist: ${song.artist}`);
        if (song.album) console.log(`   Album: ${song.album}`);
        this.loadSong(song);
      } else if (result.content?.type === "playlist") {
        const playlist = result.content.playlist;
        console.log(`\u{1F4C2} Loading playlist: ${playlist.name}`);
        console.log(`   Songs: ${playlist.songs.length}`);
        this.loadPlaylist(playlist);
      } else if (result.content?.type === "action") {
        const action = result.content.action;
        console.log(`\u26A1 Action: ${action.toUpperCase()}`);
        this.executeAction(action);
      }
    } catch (error) {
    }
  }
  /**
   * Load and play a single song
   */
  loadSong(song) {
    this.state.currentSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id)
    };
    this.state.playlist = [];
    this.state.playlistIndex = 0;
    this.state.isPlaying = true;
    this.audioEngine.play(this.state.currentSong.streamUrl, {
      title: this.state.currentSong.title,
      artist: this.state.currentSong.artist
    });
  }
  /**
   * Load and play a playlist
   */
  loadPlaylist(playlist) {
    this.state.playlist = playlist.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id)
    }));
    this.state.playlistIndex = 0;
    if (this.state.playlist.length > 0) {
      const firstSong = this.state.playlist[0];
      this.state.currentSong = firstSong;
      this.state.isPlaying = true;
      console.log(`   \u25B6\uFE0F  Playing: ${firstSong.title}`);
      if (firstSong.artist) console.log(`      ${firstSong.artist}`);
      this.audioEngine.play(firstSong.streamUrl, {
        title: firstSong.title,
        artist: firstSong.artist
      });
    }
  }
  /**
   * Execute an action command
   */
  executeAction(action) {
    switch (action) {
      case "play":
        this.play();
        break;
      case "pause":
        this.pause();
        break;
      case "next":
        this.next();
        break;
      case "previous":
        this.previous();
        break;
      case "stop":
        this.stop();
        break;
    }
  }
  /**
   * Play or resume playback
   */
  play() {
    if (this.state.currentSong && !this.state.isPlaying) {
      this.state.isPlaying = true;
      console.log(`   \u25B6\uFE0F  Resumed: ${this.state.currentSong.title}`);
      this.audioEngine.play(this.state.currentSong.streamUrl, {
        title: this.state.currentSong.title,
        artist: this.state.currentSong.artist
      });
    } else if (this.state.isPlaying) {
      console.log(`   \u26A0\uFE0F  Already playing`);
    } else {
      console.log(`   \u26A0\uFE0F  No song to play`);
    }
  }
  /**
   * Pause playback
   */
  pause() {
    if (this.state.isPlaying) {
      this.state.isPlaying = false;
      this.audioEngine.stop();
      console.log(`   \u23F8\uFE0F  Paused`);
    }
  }
  /**
   * Skip to next song in playlist
   */
  next() {
    if (this.state.playlist.length > 0) {
      this.state.playlistIndex = (this.state.playlistIndex + 1) % this.state.playlist.length;
      const nextSong = this.state.playlist[this.state.playlistIndex];
      this.state.currentSong = nextSong;
      this.state.isPlaying = true;
      console.log(`   \u23ED\uFE0F  Next: ${nextSong.title}`);
      this.audioEngine.play(nextSong.streamUrl, {
        title: nextSong.title,
        artist: nextSong.artist
      });
    } else {
      console.log(`   \u26A0\uFE0F  No playlist loaded`);
    }
  }
  /**
   * Go to previous song in playlist
   */
  previous() {
    if (this.state.playlist.length > 0) {
      this.state.playlistIndex = (this.state.playlistIndex - 1 + this.state.playlist.length) % this.state.playlist.length;
      const prevSong = this.state.playlist[this.state.playlistIndex];
      this.state.currentSong = prevSong;
      this.state.isPlaying = true;
      console.log(`   \u23EE\uFE0F  Previous: ${prevSong.title}`);
      this.audioEngine.play(prevSong.streamUrl, {
        title: prevSong.title,
        artist: prevSong.artist
      });
    } else {
      console.log(`   \u26A0\uFE0F  No playlist loaded`);
    }
  }
  /**
   * Stop playback and clear state
   */
  stop() {
    this.state.isPlaying = false;
    this.audioEngine.stop();
    this.state.currentSong = null;
    this.state.playlist = [];
    this.state.playlistIndex = 0;
    console.log(`   \u23F9\uFE0F  Stopped`);
  }
  /**
   * Get current player status
   */
  getStatus() {
    return {
      currentSong: this.state.currentSong,
      isPlaying: this.state.isPlaying,
      playlistPosition: this.state.playlist.length > 0 ? `${this.state.playlistIndex + 1}/${this.state.playlist.length}` : null
    };
  }
  /**
   * Handle audio playback completion (auto-advance)
   */
  handleAudioComplete() {
    if (this.state.playlist.length > 0) {
      const nextIndex = (this.state.playlistIndex + 1) % this.state.playlist.length;
      if (nextIndex > this.state.playlistIndex) {
        this.state.playlistIndex = nextIndex;
        const nextSong = this.state.playlist[nextIndex];
        this.state.currentSong = nextSong;
        console.log(`
\u23ED\uFE0F  Auto-playing next: ${nextSong.title}`);
        this.audioEngine.play(nextSong.streamUrl, {
          title: nextSong.title,
          artist: nextSong.artist
        });
      }
    }
  }
  /**
   * Set volume level
   * @param percent - Volume level 0-100
   */
  setVolume(percent) {
    this.audioEngine.setVolume(percent);
  }
  /**
   * Get current volume level
   * @returns Volume percentage 0-100
   */
  getVolume() {
    return this.audioEngine.getVolume();
  }
  /**
   * Increase volume
   * @param amount - Amount to increase (default: 10)
   */
  volumeUp(amount) {
    this.audioEngine.volumeUp(amount);
  }
  /**
   * Decrease volume
   * @param amount - Amount to decrease (default: 10)
   */
  volumeDown(amount) {
    this.audioEngine.volumeDown(amount);
  }
};

// src/api/ServerClient.ts
var ServerClient = class {
  constructor(serverUrl, deviceId) {
    this.serverUrl = serverUrl;
    this.deviceId = deviceId;
  }
  /**
   * Scan an NFC card and retrieve its content mapping
   * @param nfcId - The NFC card ID to scan
   * @returns The scan response with content information
   * @throws Error if the network request fails
   */
  async scanCard(nfcId) {
    try {
      const response = await fetch(`${this.serverUrl}/api/nfc/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          deviceId: this.deviceId,
          nfcId
        })
      });
      if (!response.ok && response.status !== 422) {
        console.error(`\u274C Failed to scan: ${response.status}`);
        const text = await response.text();
        console.error(`   Error: ${text}`);
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      let result;
      try {
        result = await response.json();
      } catch (error) {
        console.error(`\u274C Invalid response from server`);
        console.error(`   Status: ${response.status}`);
        throw new Error("Invalid JSON response from server");
      }
      if (response.ok && "success" in result) {
        return result;
      } else if (response.status === 422) {
        console.log(`\u26A0\uFE0F  Card not registered: ${nfcId}`);
        console.log(`   Register it at: ${this.serverUrl}/cards`);
        throw new Error("Card not registered");
      } else {
        const errorMsg = "error" in result ? result.error : "Unknown error";
        console.error(`\u274C Failed to scan: ${response.status} - ${errorMsg}`);
        throw new Error(errorMsg);
      }
    } catch (error) {
      if (error instanceof Error && error.message !== "Card not registered") {
        console.error("\u274C Network error:", error);
        console.error(`   Make sure the server is running at ${this.serverUrl}`);
      }
      throw error;
    }
  }
  /**
   * Construct the streaming URL for a song
   * @param songId - The song's database ID
   * @returns The full URL for streaming the song
   */
  getStreamUrl(songId) {
    return `${this.serverUrl}/api/stream/${songId}`;
  }
  /**
   * Get the server URL
   */
  getServerUrl() {
    return this.serverUrl;
  }
};

// src/triggers/KeyboardTrigger.ts
import * as readline from "readline";
var KeyboardTrigger = class {
  name = "keyboard";
  rl;
  playerCore;
  isStopping = false;
  async start(playerCore) {
    this.playerCore = playerCore;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "\u{1F3B4} Card ID: "
    });
    setTimeout(() => {
      console.log("\n\u{1F4FB} Player ready!");
      console.log("   Type NFC card ID and press ENTER to scan");
      console.log("   Type 'status' to see current playback state");
      console.log("   Type 'stop' to stop playback");
      console.log("   Press Ctrl+C to exit\n");
      this.rl?.prompt();
    }, 100);
    this.rl.on("line", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        this.rl?.prompt();
        return;
      }
      if (trimmed.toLowerCase() === "status") {
        this.printStatus();
        this.rl?.prompt();
        return;
      }
      if (trimmed.toLowerCase() === "stop") {
        this.playerCore?.stop();
        this.rl?.prompt();
        return;
      }
      this.playerCore?.handleCardScan(trimmed).finally(() => {
        this.rl?.prompt();
      });
    });
  }
  async stop() {
    if (this.isStopping) return;
    this.isStopping = true;
    if (this.rl) {
      this.rl.close();
      this.rl = void 0;
    }
    if (process.stdin.isTTY) {
      process.stdin.pause();
      process.stdin.destroy();
    }
  }
  printStatus() {
    const status = this.playerCore?.getStatus();
    if (!status) return;
    console.log("\n" + "\u2550".repeat(60));
    if (status.currentSong) {
      console.log(
        `${status.isPlaying ? "\u25B6\uFE0F  PLAYING" : "\u23F8\uFE0F  PAUSED"}: ${status.currentSong.title}`
      );
      if (status.currentSong.artist) {
        console.log(`   ${status.currentSong.artist}`);
      }
      if (status.playlistPosition) {
        console.log(`   Playlist: ${status.playlistPosition}`);
      }
    } else {
      console.log("\u23F9\uFE0F  No song playing");
    }
    console.log("\u2550".repeat(60));
  }
};

// src/triggers/HTTPTrigger.ts
import * as http from "http";
var HTTPTrigger = class {
  name = "http";
  server;
  playerCore;
  port;
  connections = /* @__PURE__ */ new Set();
  constructor(port = 8080) {
    this.port = port;
  }
  async start(playerCore) {
    this.playerCore = playerCore;
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Content-Type", "application/json");
      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }
      try {
        if (req.method === "POST" && url.pathname === "/scan") {
          const body = await this.readBody(req);
          const { nfcId } = JSON.parse(body);
          if (!nfcId) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing nfcId parameter" }));
            return;
          }
          await this.playerCore?.handleCardScan(nfcId);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/play") {
          console.log(`\u{1F310} HTTP: /play`);
          this.playerCore?.play();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/pause") {
          console.log(`\u{1F310} HTTP: /pause`);
          this.playerCore?.pause();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/next") {
          this.playerCore?.next();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/previous") {
          this.playerCore?.previous();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/stop") {
          console.log(`\u{1F310} HTTP: /stop`);
          this.playerCore?.stop();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } else if (req.method === "POST" && url.pathname === "/volume") {
          const body = await this.readBody(req);
          const { level } = JSON.parse(body);
          if (level === void 0 || typeof level !== "number") {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error: "Missing or invalid level parameter (0-100)"
              })
            );
            return;
          }
          this.playerCore?.setVolume(level);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume: level }));
        } else if (req.method === "POST" && url.pathname === "/volume/up") {
          this.playerCore?.volumeUp();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume }));
        } else if (req.method === "POST" && url.pathname === "/volume/down") {
          this.playerCore?.volumeDown();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, volume }));
        } else if (req.method === "GET" && url.pathname === "/status") {
          const status = this.playerCore?.getStatus();
          const volume = this.playerCore?.getVolume();
          res.writeHead(200);
          res.end(JSON.stringify({ ...status, volume }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } catch (error) {
        console.error("HTTP trigger error:", error);
        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Internal server error"
          })
        );
      }
    });
    this.server.on("connection", (conn) => {
      this.connections.add(conn);
      conn.on("close", () => {
        this.connections.delete(conn);
      });
    });
    await new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.server.unref();
        console.log(`\u{1F310} HTTP trigger listening on port ${this.port}`);
        console.log(`   Endpoints:`);
        console.log(`   - POST http://localhost:${this.port}/scan`);
        console.log(`   - POST http://localhost:${this.port}/play`);
        console.log(`   - POST http://localhost:${this.port}/pause`);
        console.log(`   - POST http://localhost:${this.port}/next`);
        console.log(`   - POST http://localhost:${this.port}/previous`);
        console.log(`   - POST http://localhost:${this.port}/stop`);
        console.log(`   - POST http://localhost:${this.port}/volume`);
        console.log(`   - POST http://localhost:${this.port}/volume/up`);
        console.log(`   - POST http://localhost:${this.port}/volume/down`);
        console.log(`   - GET  http://localhost:${this.port}/status`);
        resolve();
      });
    });
  }
  async stop() {
    if (!this.server) {
      return;
    }
    for (const conn of this.connections) {
      conn.destroy();
    }
    this.connections.clear();
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log("\n\u{1F310} HTTP trigger stopped");
        this.server = void 0;
        resolve();
      });
    });
  }
  readBody(req) {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => resolve(body));
    });
  }
};

// src/triggers/NFCReaderTrigger.ts
import { execSync as execSync2 } from "child_process";
import { existsSync as existsSync2 } from "fs";
var PN532_I2C_ADDRESS = 36;
var PN532_COMMAND_GETFIRMWAREVERSION = 2;
var PN532_COMMAND_SAMCONFIGURATION = 20;
var PN532_COMMAND_INLISTPASSIVETARGET = 74;
var PN532_PREAMBLE = 0;
var PN532_STARTCODE1 = 0;
var PN532_STARTCODE2 = 255;
var PN532_POSTAMBLE = 0;
var PN532_HOSTTOPN532 = 212;
var PN532_PN532TOHOST = 213;
var NFCReaderTrigger = class {
  name = "nfc";
  i2cBus;
  running = false;
  playerCore;
  lastCardId = null;
  pollInterval;
  constructor(i2cBus = 1) {
    this.i2cBus = i2cBus;
  }
  async start(playerCore) {
    this.playerCore = playerCore;
    this.running = true;
    const i2cPath = `/dev/i2c-${this.i2cBus}`;
    if (!existsSync2(i2cPath)) {
      console.log(`\u26A0\uFE0F  NFC Reader: I2C bus not found (${i2cPath})`);
      console.log(`   Ensure I2C is enabled in NixOS configuration`);
      return;
    }
    try {
      execSync2("i2ctransfer -V", { stdio: "pipe" });
    } catch {
      console.log(`\u26A0\uFE0F  NFC Reader: i2ctransfer not found`);
      console.log(`   Install i2c-tools package`);
      console.log(`   PATH: ${process.env.PATH}`);
      return;
    }
    try {
      await this.wakeup();
      await this.sleep(50);
      const firmware = await this.getFirmwareVersion();
      if (firmware) {
        console.log(
          `\u{1F4E1} NFC Reader initialized (PN532 IC:0x${firmware.ic.toString(16)} v${firmware.version}.${firmware.revision})`
        );
      } else {
        console.log(`\u26A0\uFE0F  NFC Reader: Could not read firmware version`);
        console.log(`   Check wiring: SDA\u2192Pin3, SCL\u2192Pin5, VCC\u21925V, GND\u2192GND`);
        return;
      }
      const samConfigured = await this.SAMConfig();
      if (!samConfigured) {
        console.log(`\u26A0\uFE0F  NFC Reader: SAM configuration failed`);
        return;
      }
      console.log(`   Polling for NFC cards...`);
      this.pollInterval = setInterval(() => this.pollForCard(), 300);
    } catch (err) {
      console.log(`\u26A0\uFE0F  NFC Reader initialization failed:`, err);
    }
  }
  /**
   * Wake up the PN532 by sending a dummy byte
   */
  async wakeup() {
    try {
      execSync2(
        `i2ctransfer -y ${this.i2cBus} w1@0x${PN532_I2C_ADDRESS.toString(16)} 0x00`,
        { stdio: "pipe" }
      );
    } catch {
    }
    await this.sleep(50);
  }
  /**
   * Get PN532 firmware version
   */
  async getFirmwareVersion() {
    const response = await this.sendCommand(
      PN532_COMMAND_GETFIRMWAREVERSION,
      []
    );
    if (response && response.length >= 3) {
      return {
        ic: response[0],
        version: response[1],
        revision: response[2]
      };
    }
    return null;
  }
  /**
   * Configure SAM (Security Access Module)
   */
  async SAMConfig() {
    const response = await this.sendCommand(PN532_COMMAND_SAMCONFIGURATION, [
      1,
      // Normal mode
      20,
      // Timeout 50ms * 20 = 1s
      1
      // Use IRQ pin
    ]);
    return response !== null;
  }
  /**
   * Poll for NFC card
   */
  async pollForCard() {
    if (!this.running) return;
    try {
      const response = await this.sendCommand(
        PN532_COMMAND_INLISTPASSIVETARGET,
        [
          1,
          // Max 1 card
          0
          // 106 kbps type A (ISO14443A)
        ]
      );
      if (response && response.length > 0) {
        const numCards = response[0];
        if (numCards > 0 && response.length >= 6) {
          const uidLength = response[5];
          if (response.length >= 6 + uidLength) {
            const uid = response.slice(6, 6 + uidLength);
            const cardId = uid.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
            if (cardId !== this.lastCardId) {
              this.lastCardId = cardId;
              console.log(`
\u{1F3B4} NFC Card detected: ${cardId}`);
              await this.playerCore?.handleCardScan(cardId);
            }
          }
        } else {
          this.lastCardId = null;
        }
      } else {
        this.lastCardId = null;
      }
    } catch {
      this.lastCardId = null;
    }
  }
  /**
   * Send command to PN532 and read response using i2ctransfer
   */
  async sendCommand(command, data) {
    try {
      const frame = this.buildFrame(command, data);
      const hexBytes = frame.map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(" ");
      execSync2(
        `i2ctransfer -y ${this.i2cBus} w${frame.length}@0x${PN532_I2C_ADDRESS.toString(16)} ${hexBytes}`,
        { stdio: "pipe" }
      );
      await this.sleep(50);
      let ready = false;
      for (let i = 0; i < 10; i++) {
        try {
          const readyResult = execSync2(
            `i2ctransfer -y ${this.i2cBus} r1@0x${PN532_I2C_ADDRESS.toString(16)}`,
            { stdio: "pipe" }
          ).toString().trim();
          const readyByte = parseInt(readyResult, 16);
          if (readyByte === 1) {
            ready = true;
            break;
          }
        } catch {
        }
        await this.sleep(10);
      }
      if (!ready) {
        return null;
      }
      execSync2(
        `i2ctransfer -y ${this.i2cBus} r7@0x${PN532_I2C_ADDRESS.toString(16)}`,
        { stdio: "pipe" }
      );
      await this.sleep(50);
      ready = false;
      for (let i = 0; i < 20; i++) {
        try {
          const readyResult = execSync2(
            `i2ctransfer -y ${this.i2cBus} r1@0x${PN532_I2C_ADDRESS.toString(16)}`,
            { stdio: "pipe" }
          ).toString().trim();
          const readyByte = parseInt(readyResult, 16);
          if (readyByte === 1) {
            ready = true;
            break;
          }
        } catch {
        }
        await this.sleep(10);
      }
      if (!ready) {
        return null;
      }
      const result = execSync2(
        `i2ctransfer -y ${this.i2cBus} r32@0x${PN532_I2C_ADDRESS.toString(16)}`,
        { stdio: "pipe" }
      ).toString().trim();
      const responseBytes = result.split(/\s+/).filter((s) => s.startsWith("0x")).map((s) => parseInt(s, 16));
      return this.parseResponse(responseBytes);
    } catch {
      return null;
    }
  }
  /**
   * Build PN532 command frame
   */
  buildFrame(command, data) {
    const length = data.length + 2;
    const frame = [];
    frame.push(PN532_PREAMBLE);
    frame.push(PN532_STARTCODE1);
    frame.push(PN532_STARTCODE2);
    frame.push(length);
    frame.push(~length + 1 & 255);
    frame.push(PN532_HOSTTOPN532);
    frame.push(command);
    frame.push(...data);
    let dcs = PN532_HOSTTOPN532 + command;
    for (const byte of data) {
      dcs += byte;
    }
    frame.push(~dcs + 1 & 255);
    frame.push(PN532_POSTAMBLE);
    return frame;
  }
  /**
   * Parse PN532 response frame
   */
  parseResponse(bytes) {
    if (bytes.length < 8) return null;
    let offset = 0;
    if (bytes[0] === 1) {
      offset = 1;
    }
    if (bytes[offset] !== PN532_PREAMBLE || bytes[offset + 1] !== PN532_STARTCODE1 || bytes[offset + 2] !== PN532_STARTCODE2) {
      return null;
    }
    const dataLength = bytes[offset + 3];
    if (bytes.length < offset + 6 + dataLength) {
      return null;
    }
    const tfi = bytes[offset + 5];
    if (tfi !== PN532_PN532TOHOST) {
      return null;
    }
    const responseData = [];
    for (let i = 0; i < dataLength - 2; i++) {
      responseData.push(bytes[offset + 7 + i]);
    }
    return responseData;
  }
  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async stop() {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = void 0;
    }
    console.log("\n\u{1F4E1} NFC Reader stopped");
  }
};

// src/triggers/ButtonTrigger.ts
import { spawn as spawn2, execSync as execSync3 } from "child_process";
import { existsSync as existsSync3 } from "fs";
var ButtonTrigger = class {
  name = "buttons";
  playerCore;
  buttons = [
    { pin: 5, action: "play-pause", label: "Play/Pause" },
    { pin: 6, action: "volume-up", label: "Volume Up" },
    { pin: 13, action: "volume-down", label: "Volume Down" },
    { pin: 16, action: "next", label: "Next Track" },
    { pin: 26, action: "previous", label: "Previous Track" }
  ];
  monitorProcess;
  lastPressTime = /* @__PURE__ */ new Map();
  debounceMs = 200;
  // Debounce delay
  gpiochip = "gpiochip0";
  // Default GPIO chip
  async start(playerCore) {
    this.playerCore = playerCore;
    if (!existsSync3(`/dev/${this.gpiochip}`)) {
      console.log(
        `\u26A0\uFE0F  GPIO chip not found (/dev/${this.gpiochip}) - button trigger disabled`
      );
      return;
    }
    try {
      execSync3("gpiomon --version", { stdio: "pipe" });
    } catch {
      console.log("\u26A0\uFE0F  gpiomon not found - button trigger disabled");
      console.log("   Install libgpiod package");
      console.log(`   PATH: ${process.env.PATH}`);
      return;
    }
    console.log(`\u{1F3AE} Button trigger initializing (libgpiod)...`);
    for (const button of this.buttons) {
      console.log(`   - GPIO ${button.pin}: ${button.label}`);
    }
    const pinArgs = this.buttons.map((b) => String(b.pin));
    try {
      this.monitorProcess = spawn2(
        "gpiomon",
        [
          "-c",
          this.gpiochip,
          // --chip
          "-b",
          "pull-up",
          // --bias
          "-e",
          "falling",
          // --edges
          ...pinArgs
          // line offsets as positional args
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      this.monitorProcess.stdout?.on("data", (data) => {
        this.handleGpioEvent(data.toString());
      });
      this.monitorProcess.stderr?.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) {
          console.log(`\u26A0\uFE0F  gpiomon error: ${msg}`);
        }
      });
      this.monitorProcess.on("error", (err) => {
        console.log(`\u26A0\uFE0F  gpiomon process error: ${err.message}`);
      });
      this.monitorProcess.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.log(`\u26A0\uFE0F  gpiomon exited with code ${code}`);
        }
      });
    } catch (err) {
      console.log(`\u26A0\uFE0F  Failed to start button monitoring: ${err}`);
    }
  }
  /**
   * Handle GPIO event from gpiomon output
   * Output format varies by libgpiod version:
   * v1.x: "offset timestamp event_type"
   * v2.x: "chip line timestamp event_type"
   */
  handleGpioEvent(data) {
    const lines = data.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      let pin;
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && this.buttons.some((b) => b.pin === num)) {
          pin = num;
          break;
        }
      }
      if (pin !== void 0) {
        this.handleButtonPress(pin);
      }
    }
  }
  /**
   * Handle button press with debouncing
   */
  handleButtonPress(pin) {
    const now = Date.now();
    const lastPress = this.lastPressTime.get(pin) || 0;
    if (now - lastPress < this.debounceMs) {
      return;
    }
    this.lastPressTime.set(pin, now);
    const button = this.buttons.find((b) => b.pin === pin);
    if (!button) return;
    console.log(`\u{1F3AE} Button pressed: ${button.label}`);
    this.executeAction(button.action);
  }
  /**
   * Execute the button's action
   */
  executeAction(action) {
    if (!this.playerCore) return;
    switch (action) {
      case "play-pause":
        const status = this.playerCore.getStatus();
        if (status.isPlaying) {
          this.playerCore.pause();
        } else {
          this.playerCore.play();
        }
        break;
      case "volume-up":
        this.playerCore.volumeUp();
        break;
      case "volume-down":
        this.playerCore.volumeDown();
        break;
      case "next":
        this.playerCore.next();
        break;
      case "previous":
        this.playerCore.previous();
        break;
    }
  }
  async stop() {
    if (this.monitorProcess) {
      this.monitorProcess.kill("SIGTERM");
      this.monitorProcess = void 0;
    }
    console.log("\n\u{1F3AE} Button trigger stopped");
  }
};

// src/services/HeartbeatService.ts
import { networkInterfaces } from "os";
var HeartbeatService = class {
  interval;
  serverUrl;
  deviceSecret;
  playerCore;
  constructor(serverUrl, deviceSecret, playerCore) {
    this.serverUrl = serverUrl;
    this.deviceSecret = deviceSecret;
    this.playerCore = playerCore;
  }
  /**
   * Start sending heartbeats
   * @param intervalMs - Interval in milliseconds (default: 30000 = 30s)
   */
  start(intervalMs = 3e4) {
    this.sendHeartbeat();
    this.interval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
    this.interval.unref();
    console.log(`\u{1F493} Heartbeat service started (every ${intervalMs / 1e3}s)`);
  }
  /**
   * Stop sending heartbeats
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = void 0;
      console.log("\u{1F493} Heartbeat service stopped");
    }
  }
  /**
   * Send a single heartbeat to the server
   */
  async sendHeartbeat() {
    try {
      const status = this.playerCore.getStatus();
      const ipAddress = this.getLocalIPAddress();
      const payload = {
        secret: this.deviceSecret,
        ipAddress
      };
      if (status.currentSong) {
        payload.currentSong = {
          title: status.currentSong.title,
          artist: status.currentSong.artist || void 0,
          isPlaying: status.isPlaying
        };
      }
      const response = await fetch(`${this.serverUrl}/api/devices/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error(`\u274C Heartbeat failed: ${response.status}`);
      }
    } catch (error) {
      console.error("\u274C Heartbeat error:", error);
    }
  }
  /**
   * Get the local IP address of this device
   * @returns IP address string or 'unknown'
   */
  getLocalIPAddress() {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      const netInterface = nets[name];
      if (!netInterface) continue;
      for (const net of netInterface) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }
    return "unknown";
  }
};

// src/config/PlayerConfig.ts
import { readFileSync, existsSync as existsSync4 } from "fs";
import { join } from "path";
function loadConfig() {
  const configPaths = [
    "./player.config.json",
    "/run/musicbox/player.config.json",
    // NixOS location (runtime)
    "/etc/musicbox/player.config.json",
    // NixOS location (legacy)
    join(process.cwd(), "player.config.json")
  ];
  for (const configPath of configPaths) {
    if (existsSync4(configPath)) {
      console.log(`\u{1F4C4} Loading config from: ${configPath}`);
      const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      return {
        deviceId: fileConfig.deviceId,
        deviceName: fileConfig.deviceName,
        deviceSecret: fileConfig.deviceSecret,
        serverUrl: fileConfig.serverUrl,
        httpPort: fileConfig.httpPort || 8080,
        triggers: {
          keyboard: {
            enabled: process.env.TRIGGER_KEYBOARD !== "false"
          },
          http: {
            enabled: true,
            // Always enable for remote control when config file exists
            port: fileConfig.httpPort || 8080
          },
          nfc: {
            enabled: process.env.TRIGGER_NFC === "true",
            i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10)
          },
          buttons: {
            enabled: process.env.TRIGGER_BUTTONS === "true"
          }
        }
      };
    }
  }
  console.log("\u26A0\uFE0F  No config file found, using environment variables");
  return {
    deviceId: 0,
    deviceName: process.env.DEVICE_NAME || "dev-player",
    deviceSecret: process.env.DEVICE_SECRET || "",
    serverUrl: process.env.SERVER_URL || "http://localhost:3000",
    httpPort: parseInt(process.env.HTTP_PORT || "8080", 10),
    triggers: {
      keyboard: {
        enabled: process.env.TRIGGER_KEYBOARD !== "false"
      },
      http: {
        enabled: process.env.TRIGGER_HTTP === "true",
        port: parseInt(process.env.HTTP_PORT || "8080", 10)
      },
      nfc: {
        enabled: process.env.TRIGGER_NFC === "true",
        i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10)
      },
      buttons: {
        enabled: process.env.TRIGGER_BUTTONS === "true"
      }
    }
  };
}

// src/index.ts
process.on("uncaughtException", (error) => {
  console.error("\u274C Uncaught exception:", error);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("\u274C Unhandled rejection at:", promise, "reason:", reason);
});
async function main() {
  console.log("\u{1F3B5} MusicBox Player");
  console.log("\u2550".repeat(60));
  const config = loadConfig();
  console.log(`\u{1F4E1} Device: ${config.deviceName}`);
  console.log(`\u{1F5A5}\uFE0F  Server: ${config.serverUrl}`);
  console.log("\u2550".repeat(60));
  const serverClient = new ServerClient(config.serverUrl, config.deviceName);
  const playerCore = new PlayerCore(serverClient);
  await playerCore.initialize();
  let heartbeatService;
  if (config.deviceSecret) {
    heartbeatService = new HeartbeatService(
      config.serverUrl,
      config.deviceSecret,
      playerCore
    );
    heartbeatService.start(3e4);
  } else {
    console.log("\u26A0\uFE0F  No device secret configured - heartbeat disabled");
    console.log(
      "   Create a device in the server UI and deploy the config file"
    );
  }
  const triggers = [];
  if (config.triggers.keyboard.enabled) {
    triggers.push(new KeyboardTrigger());
  }
  if (config.triggers.http.enabled) {
    triggers.push(new HTTPTrigger(config.triggers.http.port));
  }
  if (config.triggers.nfc.enabled) {
    triggers.push(new NFCReaderTrigger(config.triggers.nfc.i2cBus));
  }
  if (config.triggers.buttons.enabled) {
    triggers.push(new ButtonTrigger());
  }
  if (triggers.length === 0) {
    console.error("\u274C No triggers enabled!");
    console.error("   Enable at least one trigger via environment variables:");
    console.error("   - TRIGGER_KEYBOARD=true (default)");
    console.error("   - TRIGGER_HTTP=true");
    console.error("   - TRIGGER_NFC=true");
    process.exit(1);
  }
  console.log(`
\u{1F680} Starting ${triggers.length} trigger(s)...`);
  for (const trigger of triggers) {
    try {
      await trigger.start(playerCore);
    } catch (error) {
      console.error(`\u274C Failed to start ${trigger.name} trigger:`, error);
    }
  }
  console.log("");
  const keepalive = setInterval(() => {
  }, 6e4);
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) {
      process.exit(0);
    }
    isShuttingDown = true;
    console.log("\n\n\u{1F44B} Shutting down...");
    clearInterval(keepalive);
    heartbeatService?.stop();
    playerCore.stop();
    triggers.forEach((trigger) => {
      try {
        trigger.stop();
      } catch (err) {
      }
    });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
//# sourceMappingURL=musicbox-player.js.map
