/**
 * AudioEngine - Audio playback via mpv with IPC control
 *
 * Uses mpv in idle mode with JSON IPC for:
 * - Persistent audio process (no spawn/kill per song = no pops)
 * - Native playlist management
 * - Gapless playback between songs
 * - Volume and pause control
 * - Audio fade for smooth transitions
 *
 * Beeps/chimes use pre-generated WAV files played via aplay through ALSA dmix.
 *
 * Architecture:
 *   PlayerCore  ──JSON commands──>  mpv --idle --input-ipc-server
 *              <──events/replies──
 *
 *   Beeps: aplay + pre-generated WAVs (overlays via ALSA dmix)
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { SongInfo, PlayerStatus } from "../core/types.ts";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "net";
import type { Socket } from "net";
import { ToneGenerator } from "./ToneGenerator.ts";
import { AudioCache } from "./AudioCache.ts";

type CompletionCallback = () => void;

interface MpvResponse {
  event?: string;
  data?: unknown;
  request_id?: number;
  error?: string;
  name?: string;
  reason?: string;
}

export class AudioEngine {
  private mpvProcess: ChildProcess | null = null;
  private ipcSocket: Socket | null = null;
  private readonly ipcPath = "/tmp/musicbox-mpv.sock";
  private completionCallbacks: CompletionCallback[] = [];
  private currentVolume = 10; // Default volume percentage (0-100)
  private isInitialized = false;
  private requestId = 0;
  private pendingRequests = new Map<number, (response: MpvResponse) => void>();
  private toneGenerator = new ToneGenerator();
  private audioCache = new AudioCache();

  /** Playlist metadata - mirrors what's loaded in mpv */
  private playlist: SongInfo[] = [];

  constructor() {
    // No initialization needed - mpv starts on first play
  }

  /**
   * Initialize mpv process and IPC connection
   * Call this before any playback operations
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Clean up any stale socket
    if (existsSync(this.ipcPath)) {
      try {
        unlinkSync(this.ipcPath);
      } catch {
        // Ignore
      }
    }

    // Start mpv in idle mode with IPC socket
    await this.startMpv();
    this.isInitialized = true;

    // Set initial volume
    await this.setMpvVolume(this.currentVolume);

    console.log("   🎵 mpv audio engine initialized");
  }

  /**
   * Start mpv process in idle mode
   */
  private startMpv(): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        "--idle=yes", // Stay running, wait for commands
        "--input-ipc-server=" + this.ipcPath, // IPC socket path
        "--no-video", // Audio only
        "--no-terminal", // No terminal output
        "--really-quiet", // Minimal logging
        "--audio-display=no", // No visualizations
        "--gapless-audio=yes", // Gapless playback
        "--prefetch-playlist=yes", // Prefetch next track
        "--audio-buffer=0.2", // 200ms buffer (reasonable for streaming)
        "--audio-stream-silence=yes", // Keep audio stream open with silence to prevent I2S DAC pops
      ];

      this.mpvProcess = spawn("mpv", args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      this.mpvProcess.on("error", (err) => {
        console.error("   ⚠️  mpv error: " + err.message);
        console.error("      Is mpv installed?");
        reject(err);
      });

      this.mpvProcess.on("exit", (code) => {
        console.log("   ⚠️  mpv exited with code " + code);
        this.mpvProcess = null;
        this.ipcSocket = null;
        this.isInitialized = false;
      });

      // Wait for IPC socket to be created, then connect
      const checkSocket = () => {
        if (existsSync(this.ipcPath)) {
          this.connectIpc().then(resolve).catch(reject);
        } else {
          setTimeout(checkSocket, 50);
        }
      };

      // Start checking after a brief delay
      setTimeout(checkSocket, 100);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.ipcSocket) {
          reject(new Error("Timeout waiting for mpv IPC socket"));
        }
      }, 5000);
    });
  }

  /**
   * Connect to mpv IPC socket
   */
  private connectIpc(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ipcSocket = createConnection(this.ipcPath);

      this.ipcSocket.on("connect", () => {
        // Observe end-file events for track completion
        this.sendCommand(["observe_property", 1, "eof-reached"]);
        resolve();
      });

      this.ipcSocket.on("error", (err) => {
        console.error("   ⚠️  IPC socket error: " + err.message);
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
  private handleIpcData(data: Buffer): void {
    const lines = data.toString().trim().split("\n");

    for (const line of lines) {
      if (!line) continue;

      try {
        const response: MpvResponse = JSON.parse(line);

        // Handle property change events
        if (
          response.event === "property-change" &&
          response.name === "eof-reached"
        ) {
          if (response.data === true) {
            this.handleTrackEnd();
          }
        }

        // Handle end-file event (more reliable for track completion)
        if (response.event === "end-file") {
          if (response.reason === "eof") {
            this.handleTrackEnd();
          }
        }

        // Handle responses to our commands
        if (response.request_id !== undefined) {
          const handler = this.pendingRequests.get(response.request_id);
          if (handler) {
            this.pendingRequests.delete(response.request_id);
            handler(response);
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Handle track completion - log progress and notify callbacks
   */
  private async handleTrackEnd(): Promise<void> {
    const position = await this.getPlaylistPosition();

    // Check if playlist is complete
    if (position < 0 || position >= this.playlist.length) {
      const lastSong = this.playlist[this.playlist.length - 1];
      console.log(`\n✅ Finished playing: ${lastSong?.title || "Unknown"}`);
      console.log(`🏁 Playlist complete`);
    } else {
      // mpv auto-advanced to next song
      const song = this.playlist[position];
      console.log(`\n⏭️  Now playing: ${song.title}`);
    }

    // Notify any external callbacks
    this.completionCallbacks.forEach((cb) => cb());
  }

  /**
   * Send a command to mpv and optionally wait for response
   */
  private sendCommand(
    command: unknown[],
    waitForResponse = false
  ): Promise<MpvResponse | null> {
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
        }, 5000);
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
  private getPlaybackUrl(song: SongInfo): { url: string; cached: boolean } {
    // Check if already cached (sync check - no waiting)
    if (this.audioCache.isCached(song.id)) {
      // Get cached path synchronously since we know it exists
      const cachedPath = this.audioCache.getCachedPath(song.id);
      if (cachedPath) {
        return { url: cachedPath, cached: true };
      }
    }

    // Not cached - stream immediately and cache in background for next time
    this.audioCache.prefetch([{ songId: song.id, streamUrl: song.streamUrl }]);
    return { url: song.streamUrl, cached: false };
  }

  /**
   * Play a single song (replaces current playlist)
   */
  async play(song: SongInfo): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Fade out current audio if playing (prevents pop)
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50); // Quick 50ms fade
    }

    // Store as 1-item playlist
    this.playlist = [song];

    // Get playback URL (cached or streaming)
    const { url, cached } = this.getPlaybackUrl(song);

    // Load and play immediately (starts at volume 0)
    await this.sendCommand(["loadfile", url, "replace"]);

    // Fade in to target volume
    await this.fadeVolume(0, this.currentVolume, 50);

    console.log(
      `   🔊 ${cached ? "Playing" : "Streaming"}: ${song.title} (volume: ${this.currentVolume}%)`
    );
  }

  /**
   * Add a song to the playlist queue
   */
  async queueSong(song: SongInfo): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.playlist.push(song);

    // Get playback URL (cached or streaming)
    const { url } = this.getPlaybackUrl(song);
    await this.sendCommand(["loadfile", url, "append"]);
  }

  /**
   * Clear the playlist
   */
  async clearPlaylist(): Promise<void> {
    this.playlist = [];
    if (!this.isInitialized) return;
    await this.sendCommand(["playlist-clear"]);
  }

  /**
   * Load a playlist of songs - first song plays immediately, rest are queued
   */
  async loadPlaylist(songs: SongInfo[]): Promise<void> {
    if (songs.length === 0) return;

    if (!this.isInitialized) {
      await this.initialize();
    }

    // Fade out current audio if playing (prevents pop)
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50); // Quick 50ms fade
    }

    // Store the full playlist
    this.playlist = [...songs];

    // Get first song's playback URL (uses cache if available, streams otherwise)
    const { url: firstUrl, cached: firstCached } = this.getPlaybackUrl(songs[0]);

    // First song replaces current (starts at volume 0)
    await this.sendCommand(["loadfile", firstUrl, "replace"]);

    // Prefetch all songs in background (including first if it wasn't cached)
    const toPrefetch = songs.map((s) => ({ songId: s.id, streamUrl: s.streamUrl }));
    this.audioCache.prefetch(toPrefetch);

    // Queue rest of playlist
    for (let i = 1; i < songs.length; i++) {
      const { url } = this.getPlaybackUrl(songs[i]);
      await this.sendCommand(["loadfile", url, "append"]);
    }

    // Fade in to target volume
    await this.fadeVolume(0, this.currentVolume, 50);

    console.log(
      `   🔊 Loaded playlist: ${songs.length} songs ${firstCached ? "(cached)" : "(streaming)"} (volume: ${this.currentVolume}%)`
    );
  }

  /**
   * Get current song based on mpv's playlist position
   */
  async getCurrentSong(): Promise<SongInfo | null> {
    if (this.playlist.length === 0) return null;
    const position = await this.getPlaylistPosition();
    if (position < 0 || position >= this.playlist.length) return null;
    return this.playlist[position];
  }

  /**
   * Get the full playlist
   */
  getPlaylist(): SongInfo[] {
    return this.playlist;
  }

  /**
   * Get current player status
   */
  async getStatus(): Promise<PlayerStatus> {
    const position = await this.getPlaylistPosition();
    const currentSong = await this.getCurrentSong();

    return {
      currentSong,
      isPlaying: await this.isPlaying(),
      playlistPosition:
        this.playlist.length > 1
          ? `${position + 1}/${this.playlist.length}`
          : null,
    };
  }

  /**
   * Get current playlist position (0-indexed)
   */
  async getPlaylistPosition(): Promise<number> {
    if (!this.isInitialized) return 0;
    try {
      const resp = await this.sendCommand(
        ["get_property", "playlist-pos"],
        true
      );
      return (resp as { data?: number })?.data ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get playlist length
   */
  async getPlaylistLength(): Promise<number> {
    if (!this.isInitialized) return 0;
    try {
      const resp = await this.sendCommand(
        ["get_property", "playlist-count"],
        true
      );
      return (resp as { data?: number })?.data ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Stop playback and clear playlist
   */
  async stop(): Promise<void> {
    if (!this.isInitialized) return;

    // Fade out before stopping (prevents pop)
    if (await this.isPlaying()) {
      await this.fadeVolume(this.currentVolume, 0, 50);
    }

    await this.sendCommand(["stop"]);

    // Restore volume for next playback
    await this.sendCommand(["set_property", "volume", this.currentVolume]);

    this.playlist = [];
    console.log(`   ⏹️  Stopped`);
  }

  /**
   * Query mpv to check if audio is currently playing (not idle, not paused)
   */
  async isPlaying(): Promise<boolean> {
    if (!this.isInitialized) return false;
    try {
      // Parallel IPC calls for faster response
      const [idleResp, pauseResp] = await Promise.all([
        this.sendCommand(["get_property", "core-idle"], true),
        this.sendCommand(["get_property", "pause"], true),
      ]);
      const isIdle = (idleResp as { data?: boolean })?.data ?? true;
      const isPaused = (pauseResp as { data?: boolean })?.data ?? false;
      return !isIdle && !isPaused;
    } catch {
      return false;
    }
  }

  /**
   * Fade volume for smooth transitions (prevents I2S DAC pops)
   */
  private async fadeVolume(
    fromPercent: number,
    toPercent: number,
    durationMs: number
  ): Promise<void> {
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
  async pause(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.doPause();
    }
  }

  /**
   * Internal pause - assumes caller already checked state
   */
  private async doPause(): Promise<void> {
    // Fade out before pausing to prevent I2S DAC pop
    await this.fadeVolume(this.currentVolume, 0, 100);
    await this.sendCommand(["set_property", "pause", true]);
    // Keep volume at 0 while paused to prevent static on I2S DAC
    console.log(`   ⏸️  Paused`);
  }

  /**
   * Resume playback (if paused and has content) with fade-in
   */
  async resume(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    const currentSong = await this.getCurrentSong();
    if (currentSong && !playing) {
      await this.doResume(currentSong.title);
    } else if (playing) {
      console.log(`   ⚠️  Already playing`);
    } else {
      console.log(`   ⚠️  No song to play`);
    }
  }

  /**
   * Internal resume - assumes caller already checked state
   */
  private async doResume(songTitle: string): Promise<void> {
    // Start at zero volume, then fade in to prevent I2S DAC pop
    await this.sendCommand(["set_property", "volume", 0]);
    await this.sendCommand(["set_property", "pause", false]);
    await this.fadeVolume(0, this.currentVolume, 100);
    console.log(`   ▶️  Playing: ${songTitle}`);
  }

  /**
   * Toggle between play and pause
   */
  async togglePlayPause(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.doPause();
    } else {
      const currentSong = await this.getCurrentSong();
      if (currentSong) {
        await this.doResume(currentSong.title);
      } else {
        console.log(`   ⚠️  No song to play`);
      }
    }
  }

  /**
   * Query mpv to check if paused
   */
  async isPausedState(): Promise<boolean> {
    if (!this.isInitialized) return false;
    try {
      const resp = await this.sendCommand(["get_property", "pause"], true);
      return (resp as { data?: boolean })?.data ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Skip to next track in playlist
   */
  async next(): Promise<void> {
    if (!this.isInitialized) return;
    if (this.playlist.length > 1) {
      await this.sendCommand(["playlist-next"]);
      const song = await this.getCurrentSong();
      if (song) console.log(`   ⏭️  Next: ${song.title}`);
    } else {
      console.log(`   ⚠️  No playlist loaded`);
    }
  }

  /**
   * Go to previous track in playlist
   */
  async previous(): Promise<void> {
    if (!this.isInitialized) return;
    if (this.playlist.length > 1) {
      await this.sendCommand(["playlist-prev"]);
      const song = await this.getCurrentSong();
      if (song) console.log(`   ⏮️  Previous: ${song.title}`);
    } else {
      console.log(`   ⚠️  No playlist loaded`);
    }
  }

  /**
   * Register completion callback
   */
  onComplete(callback: CompletionCallback): void {
    this.completionCallbacks.push(callback);
  }

  /**
   * Set volume via mpv
   */
  private async setMpvVolume(percent: number): Promise<void> {
    if (!this.isInitialized) return;
    await this.sendCommand(["set_property", "volume", percent]);
  }

  /**
   * Set volume level
   */
  async setVolume(percent: number): Promise<void> {
    percent = Math.max(0, Math.min(100, percent));
    this.currentVolume = percent;

    if (this.isInitialized) {
      await this.setMpvVolume(percent);
      console.log("🔊 Volume: " + percent + "%");
    }
  }

  /**
   * Get current volume
   */
  getVolume(): number {
    return this.currentVolume;
  }

  /**
   * Increase volume
   */
  async volumeUp(amount: number = 10): Promise<void> {
    await this.setVolume(this.currentVolume + amount);
  }

  /**
   * Decrease volume
   */
  async volumeDown(amount: number = 10): Promise<void> {
    await this.setVolume(this.currentVolume - amount);
  }

  // ========================================================================
  // BEEPS & CHIMES - Pre-generated WAVs played via aplay through ALSA dmix
  // ========================================================================

  /**
   * Initialize the tone generator (pre-generates WAV files)
   * Call this during startup, before playing any tones
   */
  async initializeTones(): Promise<void> {
    await this.toneGenerator.initialize();
  }

  /**
   * Play startup chime to indicate player is ready
   * Call this after all systems are initialized
   */
  playStartupChime(): void {
    this.toneGenerator.playStartup();
  }

  /**
   * Play card recognition beep (can overlay with music)
   */
  playCardBeep(): void {
    this.toneGenerator.playCard();
  }

  /**
   * Play error beep (can overlay with music)
   */
  playErrorBeep(): void {
    this.toneGenerator.playError();
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  /**
   * Shutdown mpv and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.ipcSocket) {
      try {
        await this.sendCommand(["quit"]);
      } catch {
        // Ignore
      }
      this.ipcSocket.destroy();
      this.ipcSocket = null;
    }

    if (this.mpvProcess) {
      this.mpvProcess.kill("SIGTERM");
      this.mpvProcess = null;
    }

    if (existsSync(this.ipcPath)) {
      try {
        unlinkSync(this.ipcPath);
      } catch {
        // Ignore
      }
    }

    this.isInitialized = false;
  }
}
