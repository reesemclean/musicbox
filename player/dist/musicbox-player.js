#!/usr/bin/env node

// src/audio/AudioEngine.ts
import { spawn as spawn2 } from "child_process";
import { existsSync as existsSync3, unlinkSync as unlinkSync2 } from "fs";
import { createConnection } from "net";

// src/audio/ToneGenerator.ts
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { spawn } from "child_process";
var SAMPLE_RATE = 44100;
var FADE_MS = 10;
var TONE_DIR = "/tmp/musicbox-tones";
var ToneGenerator = class {
  tones = /* @__PURE__ */ new Map();
  // name -> file path
  initialized = false;
  /**
   * Generate all tone WAV files
   */
  async initialize() {
    if (this.initialized) return;
    if (!existsSync(TONE_DIR)) {
      mkdirSync(TONE_DIR, { recursive: true });
    }
    const toneSpecs = [
      {
        name: "startup",
        // C major arpeggio: C5, E5, G5, C6
        frequencies: [523, 659, 784, 1047],
        durations: [120, 120, 120, 200],
        gaps: [30, 30, 30, 0],
        volume: 0.1
      },
      {
        name: "card",
        // Quick double-beep: A5, C#6
        frequencies: [880, 1100],
        durations: [80, 80],
        gaps: [50, 0],
        volume: 0.1
      },
      {
        name: "error",
        // Low descending: ~400Hz, ~300Hz
        frequencies: [400, 300],
        durations: [150, 200],
        gaps: [50, 0],
        volume: 0.1
      }
    ];
    for (const spec of toneSpecs) {
      const filePath = `${TONE_DIR}/${spec.name}.wav`;
      this.generateToneSequence(spec, filePath);
      this.tones.set(spec.name, filePath);
    }
    this.initialized = true;
    console.log("   \u{1F514} Tone files generated");
  }
  /**
   * Generate a WAV file with a sequence of tones
   */
  generateToneSequence(spec, filePath) {
    const samples = [];
    for (let i = 0; i < spec.frequencies.length; i++) {
      const freq = spec.frequencies[i];
      const durationMs = spec.durations[i];
      const gapMs = spec.gaps[i];
      const toneSamples = this.generateTone(freq, durationMs, spec.volume);
      samples.push(...toneSamples);
      if (gapMs > 0) {
        const gapSamples = Math.floor(gapMs / 1e3 * SAMPLE_RATE);
        for (let j = 0; j < gapSamples; j++) {
          samples.push(0);
        }
      }
    }
    this.writeWav(filePath, samples);
  }
  /**
   * Generate a single tone with fade envelope
   */
  generateTone(frequency, durationMs, volume) {
    const numSamples = Math.floor(durationMs / 1e3 * SAMPLE_RATE);
    const fadeSamples = Math.floor(FADE_MS / 1e3 * SAMPLE_RATE);
    const samples = [];
    for (let i = 0; i < numSamples; i++) {
      const t = i / SAMPLE_RATE;
      let sample = Math.sin(2 * Math.PI * frequency * t) * volume;
      if (i < fadeSamples) {
        sample *= i / fadeSamples;
      } else if (i > numSamples - fadeSamples) {
        sample *= (numSamples - i) / fadeSamples;
      }
      samples.push(sample);
    }
    return samples;
  }
  /**
   * Write samples to a WAV file (16-bit mono)
   */
  writeWav(filePath, samples) {
    const numSamples = samples.length;
    const byteRate = SAMPLE_RATE * 2;
    const dataSize = numSamples * 2;
    const fileSize = 36 + dataSize;
    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;
    buffer.write("RIFF", offset);
    offset += 4;
    buffer.writeUInt32LE(fileSize, offset);
    offset += 4;
    buffer.write("WAVE", offset);
    offset += 4;
    buffer.write("fmt ", offset);
    offset += 4;
    buffer.writeUInt32LE(16, offset);
    offset += 4;
    buffer.writeUInt16LE(1, offset);
    offset += 2;
    buffer.writeUInt16LE(1, offset);
    offset += 2;
    buffer.writeUInt32LE(SAMPLE_RATE, offset);
    offset += 4;
    buffer.writeUInt32LE(byteRate, offset);
    offset += 4;
    buffer.writeUInt16LE(2, offset);
    offset += 2;
    buffer.writeUInt16LE(16, offset);
    offset += 2;
    buffer.write("data", offset);
    offset += 4;
    buffer.writeUInt32LE(dataSize, offset);
    offset += 4;
    for (const sample of samples) {
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      buffer.writeInt16LE(intSample, offset);
      offset += 2;
    }
    writeFileSync(filePath, buffer);
  }
  /**
   * Play a pre-generated tone using aplay
   */
  play(name) {
    const filePath = this.tones.get(name);
    if (!filePath) {
      console.log(`   \u26A0\uFE0F  Unknown tone: ${name}`);
      return;
    }
    const proc = spawn("aplay", ["-q", filePath], { stdio: "ignore" });
    proc.on("error", () => {
    });
  }
  /**
   * Play startup chime
   */
  playStartup() {
    this.play("startup");
  }
  /**
   * Play card recognition beep
   */
  playCard() {
    this.play("card");
  }
  /**
   * Play error beep
   */
  playError() {
    this.play("error");
  }
};

// src/audio/AudioCache.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, createWriteStream, unlinkSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
var CACHE_DIR = "/var/cache/musicbox";
var MAX_CACHE_SIZE_MB = 5e3;
var AudioCache = class {
  cache = /* @__PURE__ */ new Map();
  initialized = false;
  /**
   * Initialize the cache directory
   */
  async initialize() {
    if (this.initialized) return;
    if (!existsSync2(CACHE_DIR)) {
      try {
        mkdirSync2(CACHE_DIR, { recursive: true });
      } catch (err) {
        console.log(`   \u26A0\uFE0F  Could not create cache directory: ${err}`);
        return;
      }
    }
    try {
      const files = readdirSync(CACHE_DIR);
      for (const file of files) {
        if (file.endsWith(".mp3") || file.endsWith(".m4a") || file.endsWith(".opus")) {
          const songId = parseInt(file.split(".")[0], 10);
          if (!isNaN(songId)) {
            this.cache.set(songId, {
              songId,
              filePath: join(CACHE_DIR, file),
              downloading: false
            });
          }
        }
      }
      console.log(`   \u{1F4BE} Audio cache initialized (${this.cache.size} songs cached)`);
    } catch (err) {
      console.log(`   \u26A0\uFE0F  Could not scan cache directory: ${err}`);
    }
    this.initialized = true;
  }
  /**
   * Get the local path for a song, downloading if necessary
   * @param songId - The song's database ID
   * @param streamUrl - The URL to download from
   * @returns Local file path, or null if download failed
   */
  async getLocalPath(songId, streamUrl) {
    await this.initialize();
    const entry = this.cache.get(songId);
    if (entry && !entry.downloading && existsSync2(entry.filePath)) {
      return entry.filePath;
    }
    if (entry?.downloading && entry.downloadPromise) {
      return entry.downloadPromise;
    }
    return this.download(songId, streamUrl);
  }
  /**
   * Check if a song is cached (without downloading)
   */
  isCached(songId) {
    const entry = this.cache.get(songId);
    return !!entry && !entry.downloading && existsSync2(entry.filePath);
  }
  /**
   * Get the cached file path for a song (sync - returns null if not cached)
   */
  getCachedPath(songId) {
    const entry = this.cache.get(songId);
    if (entry && !entry.downloading && existsSync2(entry.filePath)) {
      return entry.filePath;
    }
    return null;
  }
  /**
   * Prefetch songs in the background
   * @param songs - Array of {songId, streamUrl} to prefetch
   */
  prefetch(songs) {
    for (const song of songs) {
      if (!this.isCached(song.songId)) {
        this.download(song.songId, song.streamUrl).catch(() => {
        });
      }
    }
  }
  /**
   * Download a song to the cache
   */
  async download(songId, streamUrl) {
    let ext = ".opus";
    if (streamUrl.includes(".mp3")) ext = ".mp3";
    else if (streamUrl.includes(".m4a")) ext = ".m4a";
    const filePath = join(CACHE_DIR, `${songId}${ext}`);
    const entry = {
      songId,
      filePath,
      downloading: true
    };
    const downloadPromise = this.doDownload(songId, streamUrl, filePath, entry);
    entry.downloadPromise = downloadPromise;
    this.cache.set(songId, entry);
    return downloadPromise;
  }
  /**
   * Perform the actual download
   */
  async doDownload(songId, streamUrl, filePath, entry) {
    const tempPath = `${filePath}.tmp`;
    try {
      console.log(`   \u{1F4E5} Caching song ${songId}...`);
      const response = await fetch(streamUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.body) {
        throw new Error("No response body");
      }
      const writeStream = createWriteStream(tempPath);
      await pipeline(Readable.fromWeb(response.body), writeStream);
      const { renameSync } = await import("fs");
      renameSync(tempPath, filePath);
      entry.downloading = false;
      entry.downloadPromise = void 0;
      console.log(`   \u2705 Cached song ${songId}`);
      this.cleanup().catch(() => {
      });
      return filePath;
    } catch (err) {
      try {
        if (existsSync2(tempPath)) unlinkSync(tempPath);
      } catch {
      }
      entry.downloading = false;
      entry.downloadPromise = void 0;
      this.cache.delete(songId);
      console.log(`   \u26A0\uFE0F  Failed to cache song ${songId}: ${err}`);
      return null;
    }
  }
  /**
   * Clean up old cache entries if over size limit
   */
  async cleanup() {
    if (!this.initialized) return;
    try {
      const files = readdirSync(CACHE_DIR);
      let totalSize = 0;
      const fileStats = [];
      for (const file of files) {
        const path = join(CACHE_DIR, file);
        const stat = statSync(path);
        totalSize += stat.size;
        fileStats.push({ file, path, size: stat.size, mtime: stat.mtimeMs });
      }
      const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
      if (totalSize > maxBytes) {
        fileStats.sort((a, b) => a.mtime - b.mtime);
        for (const entry of fileStats) {
          if (totalSize <= maxBytes * 0.8) break;
          try {
            unlinkSync(entry.path);
            totalSize -= entry.size;
            const songId = parseInt(entry.file.split(".")[0], 10);
            if (!isNaN(songId)) {
              this.cache.delete(songId);
            }
          } catch {
          }
        }
        console.log(`   \u{1F9F9} Cache cleanup complete`);
      }
    } catch (err) {
      console.log(`   \u26A0\uFE0F  Cache cleanup failed: ${err}`);
    }
  }
};

// src/audio/AudioEngine.ts
var AudioEngine = class {
  mpvProcess = null;
  ipcSocket = null;
  ipcPath = "/tmp/musicbox-mpv.sock";
  completionCallbacks = [];
  currentVolume = 10;
  // Default volume percentage (0-100)
  isInitialized = false;
  requestId = 0;
  pendingRequests = /* @__PURE__ */ new Map();
  toneGenerator = new ToneGenerator();
  audioCache = new AudioCache();
  /** Playlist metadata - mirrors what's loaded in mpv */
  playlist = [];
  constructor() {
  }
  /**
   * Initialize mpv process and IPC connection
   * Call this before any playback operations
   */
  async initialize() {
    if (this.isInitialized) return;
    if (existsSync3(this.ipcPath)) {
      try {
        unlinkSync2(this.ipcPath);
      } catch {
      }
    }
    await this.startMpv();
    this.isInitialized = true;
    await this.setMpvVolume(this.currentVolume);
    console.log("   \u{1F3B5} mpv audio engine initialized");
  }
  /**
   * Start mpv process in idle mode
   */
  startMpv() {
    return new Promise((resolve, reject) => {
      const args = [
        "--idle=yes",
        // Stay running, wait for commands
        "--input-ipc-server=" + this.ipcPath,
        // IPC socket path
        "--no-video",
        // Audio only
        "--no-terminal",
        // No terminal output
        "--really-quiet",
        // Minimal logging
        "--audio-display=no",
        // No visualizations
        "--gapless-audio=yes",
        // Gapless playback
        "--prefetch-playlist=yes",
        // Prefetch next track
        "--audio-buffer=0.2",
        // 200ms buffer (reasonable for streaming)
        "--audio-stream-silence=yes"
        // Keep audio stream open with silence to prevent I2S DAC pops
      ];
      this.mpvProcess = spawn2("mpv", args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false
      });
      this.mpvProcess.on("error", (err) => {
        console.error("   \u26A0\uFE0F  mpv error: " + err.message);
        console.error("      Is mpv installed?");
        reject(err);
      });
      this.mpvProcess.on("exit", (code) => {
        console.log("   \u26A0\uFE0F  mpv exited with code " + code);
        this.mpvProcess = null;
        this.ipcSocket = null;
        this.isInitialized = false;
      });
      const checkSocket = () => {
        if (existsSync3(this.ipcPath)) {
          this.connectIpc().then(resolve).catch(reject);
        } else {
          setTimeout(checkSocket, 50);
        }
      };
      setTimeout(checkSocket, 100);
      setTimeout(() => {
        if (!this.ipcSocket) {
          reject(new Error("Timeout waiting for mpv IPC socket"));
        }
      }, 5e3);
    });
  }
  /**
   * Connect to mpv IPC socket
   */
  connectIpc() {
    return new Promise((resolve, reject) => {
      this.ipcSocket = createConnection(this.ipcPath);
      this.ipcSocket.on("connect", () => {
        this.sendCommand(["observe_property", 1, "eof-reached"]);
        resolve();
      });
      this.ipcSocket.on("error", (err) => {
        console.error("   \u26A0\uFE0F  IPC socket error: " + err.message);
        reject(err);
      });
      this.ipcSocket.on("data", (data) => {
        this.handleIpcData(data);
      });
      this.ipcSocket.on("close", () => {
        this.ipcSocket = null;
      });
    });
  }
  /**
   * Handle data from mpv IPC socket
   */
  handleIpcData(data) {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const response = JSON.parse(line);
        if (response.event === "property-change" && response.name === "eof-reached") {
          if (response.data === true) {
            this.handleTrackEnd();
          }
        }
        if (response.event === "end-file") {
          if (response.reason === "eof") {
            this.handleTrackEnd();
          }
        }
        if (response.request_id !== void 0) {
          const handler = this.pendingRequests.get(response.request_id);
          if (handler) {
            this.pendingRequests.delete(response.request_id);
            handler(response);
          }
        }
      } catch {
      }
    }
  }
  /**
   * Handle track completion - log progress and notify callbacks
   */
  async handleTrackEnd() {
    const position = await this.getPlaylistPosition();
    if (position < 0 || position >= this.playlist.length) {
      const lastSong = this.playlist[this.playlist.length - 1];
      console.log(`
\u2705 Finished playing: ${lastSong?.title || "Unknown"}`);
      console.log(`\u{1F3C1} Playlist complete`);
    } else {
      const song = this.playlist[position];
      console.log(`
\u23ED\uFE0F  Now playing: ${song.title}`);
    }
    this.completionCallbacks.forEach((cb) => cb());
  }
  /**
   * Send a command to mpv and optionally wait for response
   */
  sendCommand(command, waitForResponse = false) {
    return new Promise((resolve, reject) => {
      if (!this.ipcSocket) {
        reject(new Error("IPC socket not connected"));
        return;
      }
      const reqId = ++this.requestId;
      const message = JSON.stringify({ command, request_id: reqId }) + "\n";
      if (waitForResponse) {
        this.pendingRequests.set(reqId, resolve);
        setTimeout(() => {
          if (this.pendingRequests.has(reqId)) {
            this.pendingRequests.delete(reqId);
            reject(new Error("Command timeout"));
          }
        }, 5e3);
      }
      this.ipcSocket.write(message, (err) => {
        if (err) {
          reject(err);
        } else if (!waitForResponse) {
          resolve(null);
        }
      });
    });
  }
  /**
   * Get the playback URL for a song - uses cache if available, otherwise streams
   * and triggers background caching for next time
   */
  getPlaybackUrl(song) {
    if (this.audioCache.isCached(song.id)) {
      const cachedPath = this.audioCache.getCachedPath(song.id);
      if (cachedPath) {
        return { url: cachedPath, cached: true };
      }
    }
    this.audioCache.prefetch([{ songId: song.id, streamUrl: song.streamUrl }]);
    return { url: song.streamUrl, cached: false };
  }
  /**
   * Play a single song (replaces current playlist)
   */
  async play(song) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50);
    }
    this.playlist = [song];
    const { url, cached } = this.getPlaybackUrl(song);
    await this.sendCommand(["loadfile", url, "replace"]);
    await this.fadeVolume(0, this.currentVolume, 50);
    console.log(
      `   \u{1F50A} ${cached ? "Playing" : "Streaming"}: ${song.title} (volume: ${this.currentVolume}%)`
    );
  }
  /**
   * Add a song to the playlist queue
   */
  async queueSong(song) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    this.playlist.push(song);
    const { url } = this.getPlaybackUrl(song);
    await this.sendCommand(["loadfile", url, "append"]);
  }
  /**
   * Clear the playlist
   */
  async clearPlaylist() {
    this.playlist = [];
    if (!this.isInitialized) return;
    await this.sendCommand(["playlist-clear"]);
  }
  /**
   * Load a playlist of songs - first song plays immediately, rest are queued
   */
  async loadPlaylist(songs) {
    if (songs.length === 0) return;
    if (!this.isInitialized) {
      await this.initialize();
    }
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50);
    }
    this.playlist = [...songs];
    const { url: firstUrl, cached: firstCached } = this.getPlaybackUrl(songs[0]);
    await this.sendCommand(["loadfile", firstUrl, "replace"]);
    const toPrefetch = songs.map((s) => ({ songId: s.id, streamUrl: s.streamUrl }));
    this.audioCache.prefetch(toPrefetch);
    for (let i = 1; i < songs.length; i++) {
      const { url } = this.getPlaybackUrl(songs[i]);
      await this.sendCommand(["loadfile", url, "append"]);
    }
    await this.fadeVolume(0, this.currentVolume, 50);
    console.log(
      `   \u{1F50A} Loaded playlist: ${songs.length} songs ${firstCached ? "(cached)" : "(streaming)"} (volume: ${this.currentVolume}%)`
    );
  }
  /**
   * Get current song based on mpv's playlist position
   */
  async getCurrentSong() {
    if (this.playlist.length === 0) return null;
    const position = await this.getPlaylistPosition();
    if (position < 0 || position >= this.playlist.length) return null;
    return this.playlist[position];
  }
  /**
   * Get the full playlist
   */
  getPlaylist() {
    return this.playlist;
  }
  /**
   * Get current player status
   */
  async getStatus() {
    const position = await this.getPlaylistPosition();
    const currentSong = await this.getCurrentSong();
    return {
      currentSong,
      isPlaying: await this.isPlaying(),
      playlistPosition: this.playlist.length > 1 ? `${position + 1}/${this.playlist.length}` : null
    };
  }
  /**
   * Get current playlist position (0-indexed)
   */
  async getPlaylistPosition() {
    if (!this.isInitialized) return 0;
    try {
      const resp = await this.sendCommand(
        ["get_property", "playlist-pos"],
        true
      );
      return resp?.data ?? 0;
    } catch {
      return 0;
    }
  }
  /**
   * Get playlist length
   */
  async getPlaylistLength() {
    if (!this.isInitialized) return 0;
    try {
      const resp = await this.sendCommand(
        ["get_property", "playlist-count"],
        true
      );
      return resp?.data ?? 0;
    } catch {
      return 0;
    }
  }
  /**
   * Stop playback and clear playlist
   */
  async stop() {
    if (!this.isInitialized) return;
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50);
    }
    await this.sendCommand(["stop"]);
    await this.sendCommand(["set_property", "volume", this.currentVolume]);
    this.playlist = [];
    console.log(`   \u23F9\uFE0F  Stopped`);
  }
  /**
   * Query mpv to check if audio is currently playing (not idle, not paused)
   */
  async isPlaying() {
    if (!this.isInitialized) return false;
    try {
      const [idleResp, pauseResp] = await Promise.all([
        this.sendCommand(["get_property", "core-idle"], true),
        this.sendCommand(["get_property", "pause"], true)
      ]);
      const isIdle = idleResp?.data ?? true;
      const isPaused = pauseResp?.data ?? false;
      return !isIdle && !isPaused;
    } catch {
      return false;
    }
  }
  /**
   * Fade volume for smooth transitions (prevents I2S DAC pops)
   */
  async fadeVolume(fromPercent, toPercent, durationMs) {
    const steps = 10;
    const stepDuration = durationMs / steps;
    const volumeStep = (toPercent - fromPercent) / steps;
    for (let i = 1; i <= steps; i++) {
      const volume = fromPercent + volumeStep * i;
      await this.sendCommand(["set_property", "volume", volume]);
      await new Promise((resolve) => setTimeout(resolve, stepDuration));
    }
  }
  /**
   * Pause playback (if playing) with fade-out to prevent DAC pops
   */
  async pause() {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.doPause();
    }
  }
  /**
   * Internal pause - assumes caller already checked state
   */
  async doPause() {
    await this.fadeVolume(this.currentVolume, 0, 100);
    await this.sendCommand(["set_property", "pause", true]);
    console.log(`   \u23F8\uFE0F  Paused`);
  }
  /**
   * Resume playback (if paused and has content) with fade-in
   */
  async resume() {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    const currentSong = await this.getCurrentSong();
    if (currentSong && !playing) {
      await this.doResume(currentSong.title);
    } else if (playing) {
      console.log(`   \u26A0\uFE0F  Already playing`);
    } else {
      console.log(`   \u26A0\uFE0F  No song to play`);
    }
  }
  /**
   * Internal resume - assumes caller already checked state
   */
  async doResume(songTitle) {
    await this.sendCommand(["set_property", "volume", 0]);
    await this.sendCommand(["set_property", "pause", false]);
    await this.fadeVolume(0, this.currentVolume, 100);
    console.log(`   \u25B6\uFE0F  Playing: ${songTitle}`);
  }
  /**
   * Toggle between play and pause
   */
  async togglePlayPause() {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.doPause();
    } else {
      const currentSong = await this.getCurrentSong();
      if (currentSong) {
        await this.doResume(currentSong.title);
      } else {
        console.log(`   \u26A0\uFE0F  No song to play`);
      }
    }
  }
  /**
   * Query mpv to check if paused
   */
  async isPausedState() {
    if (!this.isInitialized) return false;
    try {
      const resp = await this.sendCommand(["get_property", "pause"], true);
      return resp?.data ?? false;
    } catch {
      return false;
    }
  }
  /**
   * Skip to next track in playlist
   */
  async next() {
    if (!this.isInitialized) return;
    if (this.playlist.length > 1) {
      await this.sendCommand(["playlist-next"]);
      const song = await this.getCurrentSong();
      if (song) console.log(`   \u23ED\uFE0F  Next: ${song.title}`);
    } else {
      console.log(`   \u26A0\uFE0F  No playlist loaded`);
    }
  }
  /**
   * Go to previous track in playlist
   */
  async previous() {
    if (!this.isInitialized) return;
    if (this.playlist.length > 1) {
      await this.sendCommand(["playlist-prev"]);
      const song = await this.getCurrentSong();
      if (song) console.log(`   \u23EE\uFE0F  Previous: ${song.title}`);
    } else {
      console.log(`   \u26A0\uFE0F  No playlist loaded`);
    }
  }
  /**
   * Register completion callback
   */
  onComplete(callback) {
    this.completionCallbacks.push(callback);
  }
  /**
   * Set volume via mpv
   */
  async setMpvVolume(percent) {
    if (!this.isInitialized) return;
    await this.sendCommand(["set_property", "volume", percent]);
  }
  /**
   * Set volume level
   */
  async setVolume(percent) {
    percent = Math.max(0, Math.min(100, percent));
    this.currentVolume = percent;
    if (this.isInitialized) {
      await this.setMpvVolume(percent);
      console.log("\u{1F50A} Volume: " + percent + "%");
    }
  }
  /**
   * Get current volume
   */
  getVolume() {
    return this.currentVolume;
  }
  /**
   * Increase volume
   */
  async volumeUp(amount = 10) {
    await this.setVolume(this.currentVolume + amount);
  }
  /**
   * Decrease volume
   */
  async volumeDown(amount = 10) {
    await this.setVolume(this.currentVolume - amount);
  }
  // ========================================================================
  // BEEPS & CHIMES - Pre-generated WAVs played via aplay through ALSA dmix
  // ========================================================================
  /**
   * Play startup chime
   * Initializes mpv first (opens audio stream with silence), then plays chime
   */
  async playStartupChime() {
    try {
      await this.initialize();
    } catch {
      console.log("   \u26A0\uFE0F  mpv initialization failed");
    }
    await this.toneGenerator.initialize();
    this.toneGenerator.playStartup();
  }
  /**
   * Play card recognition beep (can overlay with music)
   */
  playCardBeep() {
    this.toneGenerator.playCard();
  }
  /**
   * Play error beep (can overlay with music)
   */
  playErrorBeep() {
    this.toneGenerator.playError();
  }
  // ========================================================================
  // CLEANUP
  // ========================================================================
  /**
   * Shutdown mpv and cleanup
   */
  async shutdown() {
    if (this.ipcSocket) {
      try {
        await this.sendCommand(["quit"]);
      } catch {
      }
      this.ipcSocket.destroy();
      this.ipcSocket = null;
    }
    if (this.mpvProcess) {
      this.mpvProcess.kill("SIGTERM");
      this.mpvProcess = null;
    }
    if (existsSync3(this.ipcPath)) {
      try {
        unlinkSync2(this.ipcPath);
      } catch {
      }
    }
    this.isInitialized = false;
  }
};

// src/core/PlayerCore.ts
var PlayerCore = class {
  audioEngine;
  serverClient;
  constructor(serverClient, audioEngine) {
    this.serverClient = serverClient;
    this.audioEngine = audioEngine || new AudioEngine();
  }
  /**
   * Initialize the player and play startup chime
   */
  async initialize() {
    await this.audioEngine.playStartupChime();
    console.log("\u{1F3B5} Player ready!");
  }
  /**
   * Handle an NFC card scan
   * @param nfcId - The NFC card ID that was scanned
   */
  async handleCardScan(nfcId) {
    this.audioEngine.playCardBeep();
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
      } else {
        console.log(`\u26A0\uFE0F  Card not recognized`);
        this.audioEngine.playErrorBeep();
      }
    } catch (error) {
      this.audioEngine.playErrorBeep();
    }
  }
  /**
   * Load and play a single song
   */
  loadSong(song) {
    this.audioEngine.play({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id)
    });
  }
  /**
   * Load and play a playlist
   */
  loadPlaylist(playlist) {
    const songs = playlist.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id)
    }));
    if (songs.length > 0) {
      console.log(`   \u25B6\uFE0F  Playing: ${songs[0].title}`);
      if (songs[0].artist) console.log(`      ${songs[0].artist}`);
      this.audioEngine.loadPlaylist(songs);
    }
  }
  /**
   * Execute an action command
   */
  async executeAction(action) {
    switch (action) {
      case "play":
        await this.play();
        break;
      case "pause":
        await this.pause();
        break;
      case "next":
        await this.next();
        break;
      case "previous":
        await this.previous();
        break;
      case "stop":
        await this.stop();
        break;
    }
  }
  // --- Playback controls (pass-through to AudioEngine) ---
  play() {
    return this.audioEngine.resume();
  }
  pause() {
    return this.audioEngine.pause();
  }
  togglePlayPause() {
    return this.audioEngine.togglePlayPause();
  }
  next() {
    return this.audioEngine.next();
  }
  previous() {
    return this.audioEngine.previous();
  }
  stop() {
    return this.audioEngine.stop();
  }
  getStatus() {
    return this.audioEngine.getStatus();
  }
  // --- Volume controls ---
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
  async printStatus() {
    const status = await this.playerCore?.getStatus();
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
import { execSync } from "child_process";
import { existsSync as existsSync4 } from "fs";
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
    if (!existsSync4(i2cPath)) {
      console.log(`\u26A0\uFE0F  NFC Reader: I2C bus not found (${i2cPath})`);
      console.log(`   Ensure I2C is enabled in NixOS configuration`);
      return;
    }
    try {
      execSync("i2ctransfer -V", { stdio: "pipe" });
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
      execSync(
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
      execSync(
        `i2ctransfer -y ${this.i2cBus} w${frame.length}@0x${PN532_I2C_ADDRESS.toString(16)} ${hexBytes}`,
        { stdio: "pipe" }
      );
      await this.sleep(50);
      let ready = false;
      for (let i = 0; i < 10; i++) {
        try {
          const readyResult = execSync(
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
      execSync(
        `i2ctransfer -y ${this.i2cBus} r7@0x${PN532_I2C_ADDRESS.toString(16)}`,
        { stdio: "pipe" }
      );
      await this.sleep(50);
      ready = false;
      for (let i = 0; i < 20; i++) {
        try {
          const readyResult = execSync(
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
      const result = execSync(
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
import { spawn as spawn3, execSync as execSync2 } from "child_process";
import { existsSync as existsSync5 } from "fs";
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
  // Shorter debounce to allow rapid presses for restart
  restartPresses = [];
  // Timestamps of rapid Volume Down presses
  restartPressesNeeded = 5;
  // Press Volume Down 5 times rapidly to restart
  restartWindowMs = 3e3;
  // Within 3 seconds
  gpiochip = "gpiochip0";
  // Default GPIO chip
  async start(playerCore) {
    this.playerCore = playerCore;
    if (!existsSync5(`/dev/${this.gpiochip}`)) {
      console.log(
        `\u26A0\uFE0F  GPIO chip not found (/dev/${this.gpiochip}) - button trigger disabled`
      );
      return;
    }
    try {
      execSync2("gpiomon --version", { stdio: "pipe" });
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
      this.monitorProcess = spawn3(
        "gpiomon",
        [
          "-c",
          this.gpiochip,
          // --chip
          "-b",
          "pull-up",
          // --bias
          "-e",
          "both",
          // --edges (both falling=press and rising=release)
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
      let isFalling = false;
      let isRising = false;
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && this.buttons.some((b) => b.pin === num)) {
          pin = num;
        }
        if (part.toLowerCase() === "falling") {
          isFalling = true;
        }
        if (part.toLowerCase() === "rising") {
          isRising = true;
        }
      }
      if (pin !== void 0 && isFalling) {
        this.handleButtonPress(pin);
      }
    }
  }
  /**
   * Trigger a service restart
   */
  triggerRestart() {
    console.log("\u{1F504} Restarting musicbox-player service...");
    try {
      execSync2("systemctl restart musicbox-player", { stdio: "inherit" });
    } catch (err) {
      console.error("\u26A0\uFE0F  Failed to restart service:", err);
      process.exit(1);
    }
  }
  /**
   * Check if volume down was pressed rapidly for restart
   */
  checkRestartCombo(pin, now) {
    const volumeDownPin = 13;
    if (pin !== volumeDownPin) {
      this.restartPresses = [];
      return;
    }
    this.restartPresses.push(now);
    this.restartPresses = this.restartPresses.filter(
      (t) => now - t < this.restartWindowMs
    );
    if (this.restartPresses.length >= this.restartPressesNeeded) {
      this.restartPresses = [];
      this.triggerRestart();
    } else if (this.restartPresses.length >= 3) {
      console.log(
        `\u{1F504} Restart: ${this.restartPresses.length}/${this.restartPressesNeeded} presses...`
      );
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
    this.checkRestartCombo(pin, now);
    const button = this.buttons.find((b) => b.pin === pin);
    if (!button) return;
    console.log(`\u{1F3AE} Button pressed: ${button.label}`);
    this.executeAction(button.action);
  }
  /**
   * Execute the button's action
   */
  async executeAction(action) {
    if (!this.playerCore) return;
    switch (action) {
      case "play-pause":
        await this.playerCore.togglePlayPause();
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
  consecutiveFailures = 0;
  maxBackoffMs = 3e5;
  // Max 5 minutes between retries
  baseIntervalMs;
  constructor(serverUrl, deviceSecret, playerCore) {
    this.serverUrl = serverUrl;
    this.deviceSecret = deviceSecret;
    this.playerCore = playerCore;
    this.baseIntervalMs = 3e4;
  }
  /**
   * Start sending heartbeats
   * @param intervalMs - Interval in milliseconds (default: 30000 = 30s)
   */
  start(intervalMs = 3e4) {
    this.sendHeartbeat();
    this.scheduleNextHeartbeat(intervalMs);
    console.log(`\u{1F493} Heartbeat service started (every ${intervalMs / 1e3}s)`);
  }
  /**
   * Schedule the next heartbeat with exponential backoff on failures
   */
  scheduleNextHeartbeat(baseInterval) {
    const backoffMultiplier = Math.min(
      Math.pow(2, this.consecutiveFailures),
      10
    );
    const delay = Math.min(baseInterval * backoffMultiplier, this.maxBackoffMs);
    this.interval = setTimeout(() => {
      this.sendHeartbeat();
      this.scheduleNextHeartbeat(baseInterval);
    }, delay);
    this.interval.unref();
  }
  /**
   * Stop sending heartbeats
   */
  stop() {
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = void 0;
      console.log("\u{1F493} Heartbeat service stopped");
    }
  }
  /**
   * Send a single heartbeat to the server
   */
  async sendHeartbeat() {
    try {
      const status = await this.playerCore.getStatus();
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5e3);
      const response = await fetch(`${this.serverUrl}/api/devices/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 1) {
          console.error(`\u274C Heartbeat failed: ${response.status}`);
        }
      } else {
        if (this.consecutiveFailures > 0) {
          console.log(`\u{1F493} Server connection restored`);
        }
        this.consecutiveFailures = 0;
      }
    } catch (error) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures === 1) {
        console.error(`\u274C Server unreachable: ${this.serverUrl}`);
      } else if (this.consecutiveFailures % 10 === 0) {
        console.error(
          `\u274C Server still unreachable (${this.consecutiveFailures} failures)`
        );
      }
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
import { readFileSync, existsSync as existsSync6 } from "fs";
import { join as join2 } from "path";
function loadConfig() {
  const configPaths = [
    "./player.config.json",
    "/run/musicbox/player.config.json",
    // NixOS location (runtime)
    "/etc/musicbox/player.config.json",
    // NixOS location (legacy)
    join2(process.cwd(), "player.config.json")
  ];
  for (const configPath of configPaths) {
    if (existsSync6(configPath)) {
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
