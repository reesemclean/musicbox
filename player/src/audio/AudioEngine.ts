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
 * Beeps/chimes use speaker-test separately so they can overlay with music.
 *
 * Architecture:
 *   PlayerCore  ──JSON commands──>  mpv --idle --input-ipc-server
 *              <──events/replies──
 *
 *   Beeps: speaker-test (separate process, can overlay)
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { SongInfo, PlayerStatus } from "../core/types.ts";
import { existsSync, unlinkSync } from "fs";
import { createConnection } from "net";
import type { Socket } from "net";

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
        "--af=afade=t=in:st=0:d=0.1", // 100ms fade-in on all audio
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
   * Play a single song (replaces current playlist)
   */
  async play(song: SongInfo): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Store as 1-item playlist
    this.playlist = [song];

    // Load and play immediately
    await this.sendCommand(["loadfile", song.streamUrl, "replace"]);

    console.log(
      "   🔊 Streaming: " +
        song.title +
        " (volume: " +
        this.currentVolume +
        "%)"
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
    await this.sendCommand(["loadfile", song.streamUrl, "append"]);
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

    // Store the full playlist
    this.playlist = [...songs];

    // First song replaces current (starts playing)
    await this.sendCommand(["loadfile", songs[0].streamUrl, "replace"]);

    // Rest get appended to queue
    for (let i = 1; i < songs.length; i++) {
      await this.sendCommand(["loadfile", songs[i].streamUrl, "append"]);
    }

    console.log(
      "   🔊 Loaded playlist: " +
        songs.length +
        " songs (volume: " +
        this.currentVolume +
        "%)"
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
    await this.sendCommand(["stop"]);
    this.playlist = [];
    console.log(`   ⏹️  Stopped`);
  }

  /**
   * Query mpv to check if audio is currently playing (not idle, not paused)
   */
  async isPlaying(): Promise<boolean> {
    if (!this.isInitialized) return false;
    try {
      const idleResp = await this.sendCommand(
        ["get_property", "core-idle"],
        true
      );
      const pauseResp = await this.sendCommand(["get_property", "pause"], true);
      const isIdle = (idleResp as { data?: boolean })?.data ?? true;
      const isPaused = (pauseResp as { data?: boolean })?.data ?? false;
      return !isIdle && !isPaused;
    } catch {
      return false;
    }
  }

  /**
   * Pause playback (if playing)
   */
  async pause(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.sendCommand(["set_property", "pause", true]);
      console.log(`   ⏸️  Paused`);
    }
  }

  /**
   * Resume playback (if paused and has content)
   */
  async resume(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    const currentSong = await this.getCurrentSong();
    if (currentSong && !playing) {
      await this.sendCommand(["set_property", "pause", false]);
      console.log(`   ▶️  Playing: ${currentSong.title}`);
    } else if (playing) {
      console.log(`   ⚠️  Already playing`);
    } else {
      console.log(`   ⚠️  No song to play`);
    }
  }

  /**
   * Toggle between play and pause
   */
  async togglePlayPause(): Promise<void> {
    if (!this.isInitialized) return;
    const playing = await this.isPlaying();
    if (playing) {
      await this.pause();
    } else {
      await this.resume();
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
  // BEEPS & CHIMES - Use speaker-test so they can overlay with music
  // ========================================================================

  /**
   * Play a single tone using speaker-test (overlays with mpv audio)
   */
  private playTone(frequency: number, durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      const proc = spawn(
        "speaker-test",
        ["-t", "sine", "-f", frequency.toString(), "-c", "2", "-l", "1"],
        { stdio: "ignore" }
      );

      // Kill after duration
      setTimeout(() => {
        proc.kill("SIGTERM");
        resolve();
      }, durationMs);

      proc.on("exit", () => resolve());
      proc.on("error", () => resolve());
    });
  }

  /**
   * Play startup chime (can overlay if something is playing)
   * C major arpeggio: C5, E5, G5, C6
   */
  async playStartupChime(): Promise<void> {
    // Initialize mpv in the background
    this.initialize().catch(() => {
      console.log("   ⚠️  mpv initialization failed");
    });

    const notes = [
      { freq: 523, duration: 120 }, // C5
      { freq: 659, duration: 120 }, // E5
      { freq: 784, duration: 120 }, // G5
      { freq: 1047, duration: 200 }, // C6 (hold longer)
    ];

    try {
      for (const note of notes) {
        await this.playTone(note.freq, note.duration);
        await this.sleep(30);
      }
    } catch {
      console.log("   ⚠️  Startup chime failed");
    }
  }

  /**
   * Play card recognition beep (can overlay with music)
   * Quick double-beep: high-pitched, short
   */
  async playCardBeep(): Promise<void> {
    try {
      await this.playTone(880, 80); // A5
      await this.sleep(50);
      await this.playTone(1100, 80); // C#6
    } catch {
      // Beep failed, not critical
    }
  }

  /**
   * Play error beep (can overlay with music)
   * Low descending tone indicates error
   */
  async playErrorBeep(): Promise<void> {
    try {
      await this.playTone(400, 150);
      await this.sleep(50);
      await this.playTone(300, 200);
    } catch {
      // Beep failed, not critical
    }
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

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
