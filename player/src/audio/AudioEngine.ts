/**
 * AudioEngine - Platform-agnostic audio playback abstraction
 *
 * Handles:
 * - Spawning audio player processes (ffplay, mpg123, afplay)
 * - Process lifecycle management
 * - Completion event notifications
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { SongMetadata } from "../core/types.ts";

type CompletionCallback = () => void;

export class AudioEngine {
  private audioProcess: ChildProcess | null = null;
  private completionCallbacks: CompletionCallback[] = [];

  /**
   * Play audio from a stream URL
   * @param streamUrl - The URL to stream from
   * @param metadata - Song metadata for logging
   */
  play(streamUrl: string, metadata: SongMetadata): void {
    this.stop();

    console.log(`   🔊 Streaming audio...`);

    // Try ffplay first (comes with ffmpeg), fall back to mpg123, then afplay
    const players = [
      {
        cmd: "ffplay",
        args: [
          "-nodisp",
          "-autoexit",
          "-loglevel",
          "quiet",
          "-fflags",
          "nobuffer",
          streamUrl,
        ],
      },
      { cmd: "mpg123", args: ["-q", streamUrl] },
    ];

    let playerStarted = false;

    for (const player of players) {
      try {
        this.audioProcess = spawn(player.cmd, player.args, {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false, // Keep attached to this process
        });

        this.audioProcess.on("error", (err) => {
          // Try next player
        });

        this.audioProcess.on("exit", (code) => {
          if (this.audioProcess) {
            this.audioProcess = null;
            if (code === 0) {
              console.log(`\n✅ Finished playing: ${metadata.title}`);
              // Notify all completion callbacks
              this.completionCallbacks.forEach((cb) => cb());
            }
          }
        });

        playerStarted = true;
        break;
      } catch (err) {
        // Try next player
        continue;
      }
    }

    if (!playerStarted) {
      console.log(
        `   ⚠️  No audio player found (tried ffplay, mpg123, afplay)`
      );
      console.log(`   Install: brew install ffmpeg  (or mpg123)`);
    }
  }

  /**
   * Stop the currently playing audio
   */
  stop(): void {
    if (this.audioProcess) {
      try {
        // Kill forcefully with SIGKILL
        this.audioProcess.kill("SIGKILL");
      } catch (err) {
        // Process might already be dead
      }
      this.audioProcess = null;
    }
  }

  /**
   * Check if audio is currently playing
   */
  isPlaying(): boolean {
    return this.audioProcess !== null;
  }

  /**
   * Register a callback to be called when audio playback completes
   * @param callback - Function to call on completion
   */
  onComplete(callback: CompletionCallback): void {
    this.completionCallbacks.push(callback);
  }
}
