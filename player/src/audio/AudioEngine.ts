/**
 * AudioEngine - Platform-agnostic audio playback abstraction
 *
 * Handles:
 * - Spawning audio player processes (ffplay, mpg123, afplay)
 * - Process lifecycle management
 * - Completion event notifications
 * - MAX98357A shutdown control via GPIO
 */

import { spawn, execSync } from "child_process";
import type { ChildProcess } from "child_process";
import type { SongMetadata } from "../core/types.ts";
import { existsSync } from "fs";

type CompletionCallback = () => void;

export class AudioEngine {
  private audioProcess: ChildProcess | null = null;
  private completionCallbacks: CompletionCallback[] = [];
  private readonly amplifierPin = 22; // GPIO 22 for MAX98357A SD pin
  private gpioAvailable = false;
  private currentVolume = 10; // Default volume percentage (0-100)
  private isPaused = false;
  private currentMetadata: SongMetadata | null = null;

  constructor() {
    this.initializeGPIO();
    this.initializeVolume();
  }

  /**
   * Initialize volume control
   */
  private initializeVolume(): void {
    try {
      // Check what volume control method is available
      this.detectVolumeControl();
      // Try to set initial volume (may fail silently if softvol not created yet)
      this.tryAmixerVolume(this.currentVolume, true);
      console.log(`   🔊 Volume control initialized (${this.currentVolume}%)`);
    } catch (err) {
      console.log(`   ⚠️  Volume control not available`);
    }
  }

  /**
   * Detect available volume control method
   * Uses ALSA amixer (softvol) for embedded systems
   */
  private volumeAvailable = false;

  private detectVolumeControl(): void {
    try {
      execSync("amixer --version", { stdio: "pipe" });
      this.volumeAvailable = true;
      console.log(`   🔊 Using ALSA volume control`);
    } catch {
      console.log(`   ⚠️  Volume control unavailable - amixer not found`);
      console.log(`      Install alsa-utils for volume control`);
    }
  }

  /**
   * Initialize GPIO control for MAX98357A shutdown pin
   * Uses libgpiod (gpioset) instead of deprecated sysfs interface
   */
  private initializeGPIO(): void {
    try {
      // Check if we're on a Raspberry Pi with GPIO character device
      if (!existsSync("/dev/gpiochip0")) {
        return;
      }

      // Check if gpioset is available by trying to run it
      try {
        execSync("gpioset --version", { stdio: "pipe" });
      } catch {
        console.log(`   ⚠️  gpioset not found - amplifier control disabled`);
        console.log(`   PATH: ${process.env.PATH}`);
        return;
      }

      // Start with amplifier off (SD pin LOW = shutdown)
      this.setAmplifier(false);
      this.gpioAvailable = true;

      console.log(
        `   🔌 MAX98357A shutdown control initialized (GPIO ${this.amplifierPin})`
      );
    } catch (err) {
      // GPIO not available or no permissions - audio will still work
      console.log(`   ⚠️  GPIO control not available - amplifier always on`);
    }
  }

  /**
   * Control MAX98357A shutdown pin using libgpiod
   * @param enabled - true = amplifier on (SD HIGH), false = amplifier off (SD LOW)
   */
  private setAmplifier(enabled: boolean): void {
    if (!this.gpioAvailable) return;

    try {
      const value = enabled ? "1" : "0";
      // libgpiod v2.x: -c for chip, -t 0 to set value and exit immediately
      execSync(`gpioset -c 0 -t 0 ${this.amplifierPin}=${value}`);
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Play audio from a stream URL
   * @param streamUrl - The URL to stream from
   * @param metadata - Song metadata for logging
   */
  play(streamUrl: string, metadata: SongMetadata): void {
    this.stop();

    // Enable amplifier before playing, with delay to prevent click/pop
    this.enableAmplifierAndPlay(streamUrl, metadata);
  }

  /**
   * Enable amplifier with stabilization delay, then start playback
   */
  private async enableAmplifierAndPlay(
    streamUrl: string,
    metadata: SongMetadata
  ): Promise<void> {
    this.setAmplifier(true);

    // Wait for amplifier to stabilize (prevents click/pop sound)
    // MAX98357A needs ~100-150ms to fully stabilize
    await this.sleep(150);

    console.log(`   🔊 Streaming audio... (volume: ${this.currentVolume}%)`);

    // Build ffplay args - optimized for low latency streaming
    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      // Low-latency flags
      "-fflags",
      "nobuffer+fastseek",
      "-flags",
      "low_delay",
      "-probesize",
      "32",           // Minimal probe (bytes) - faster format detection
      "-analyzeduration",
      "0",            // Don't analyze - start immediately
      "-sync",
      "audio",        // Sync to audio clock
      "-framedrop",   // Drop frames if behind (irrelevant for audio-only but doesn't hurt)
    ];

    // Only use ffplay volume filter as fallback when no system control
    if (!this.volumeAvailable) {
      const volumeMultiplier = this.currentVolume / 100;
      ffplayArgs.push("-af", `volume=${volumeMultiplier}`);
    }

    ffplayArgs.push(streamUrl);

    // Store metadata for logging
    this.currentMetadata = metadata;
    this.isPaused = false;

    // Use ffplay from ffmpeg for audio playback
    // Use pipe for stdin so we can send pause command
    try {
      this.audioProcess = spawn("ffplay", ffplayArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        detached: false,
      });

      this.audioProcess.on("error", (err) => {
        console.log(`   ⚠️  ffplay error: ${err.message}`);
        console.log(`      Install ffmpeg for audio playback`);
      });

      this.audioProcess.on("exit", (code) => {
        const wasPlaying = this.audioProcess !== null;
        const title = this.currentMetadata?.title || "Unknown";
        this.audioProcess = null;
        this.currentMetadata = null;
        this.isPaused = false;
        
        if (wasPlaying) {
          // Delay before disabling amp to prevent click on stop
          setTimeout(() => {
            if (!this.audioProcess) {
              this.setAmplifier(false);
            }
          }, 100);
          if (code === 0) {
            console.log(`\n✅ Finished playing: ${title}`);
            // Notify all completion callbacks
            this.completionCallbacks.forEach((cb) => cb());
          }
        }
      });
    } catch (err) {
      console.log(`   ⚠️  Failed to start ffplay`);
      console.log(`      Install ffmpeg for audio playback`);
      this.setAmplifier(false);
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
      // Delay before disabling amp to prevent click (async, fire-and-forget)
      setTimeout(() => {
        if (!this.audioProcess) {
          this.setAmplifier(false);
        }
      }, 50);
    } else {
      // No process running, disable amp immediately
      this.setAmplifier(false);
    }
  }

  /**
   * Check if audio is currently playing (not paused)
   */
  isPlaying(): boolean {
    return this.audioProcess !== null && !this.isPaused;
  }

  /**
   * Pause playback (keeps position)
   */
  pause(): void {
    if (this.audioProcess && !this.isPaused) {
      // Send 'p' to ffplay stdin to toggle pause
      try {
        this.audioProcess.stdin?.write("p");
        this.isPaused = true;
      } catch (err) {
        // Process might be dead
      }
    }
  }

  /**
   * Resume playback from paused state
   */
  resume(): void {
    if (this.audioProcess && this.isPaused) {
      // Send 'p' to ffplay stdin to toggle pause (unpause)
      try {
        this.audioProcess.stdin?.write("p");
        this.isPaused = false;
      } catch (err) {
        // Process might be dead
      }
    }
  }

  /**
   * Check if audio is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Register a callback to be called when audio playback completes
   * @param callback - Function to call on completion
   */
  onComplete(callback: CompletionCallback): void {
    this.completionCallbacks.push(callback);
  }

  /**
   * Set volume level - applies immediately to current and future playback
   * @param percent - Volume level 0-100
   */
  setVolume(percent: number): void {
    // Clamp to 0-100
    percent = Math.max(0, Math.min(100, percent));
    this.currentVolume = percent;

    if (this.volumeAvailable) {
      this.tryAmixerVolume(percent);
    }
  }

  /**
   * Try setting volume via ALSA amixer
   */
  private tryAmixerVolume(percent: number, silent = false): void {
    // softvol "Master" control is created on first audio playback
    // Try known control names
    const controls = ["Master", "PCM", "Speaker", "Headphone"];

    for (const control of controls) {
      try {
        execSync(`amixer -q sset ${control} ${percent}%`, { stdio: "pipe" });
        if (!silent) {
          console.log(`🔊 Volume: ${percent}%`);
        }
        return;
      } catch {}
    }
    // Only log failure if not in silent mode (initial setup before audio plays)
    if (!silent) {
      console.log(`⚠️  ALSA volume control failed`);
    }
  }

  /**
   * Get current volume level
   * @returns Volume percentage 0-100
   */
  getVolume(): number {
    return this.currentVolume;
  }

  /**
   * Increase volume by amount
   * @param amount - Amount to increase (default: 10)
   */
  volumeUp(amount: number = 10): void {
    this.setVolume(this.currentVolume + amount);
  }

  /**
   * Decrease volume by amount
   * @param amount - Amount to decrease (default: 10)
   */
  volumeDown(amount: number = 10): void {
    this.setVolume(this.currentVolume - amount);
  }

  /**
   * Play a startup chime to indicate the player is ready
   * Uses speaker-test to generate a pleasant ascending arpeggio
   */
  async playStartupChime(): Promise<void> {
    // Enable amplifier for the chime
    this.setAmplifier(true);

    // C major arpeggio: C5, E5, G5, C6 (ascending, cheerful)
    const notes = [
      { freq: 523, duration: 120 }, // C5
      { freq: 659, duration: 120 }, // E5
      { freq: 784, duration: 120 }, // G5
      { freq: 1047, duration: 200 }, // C6 (hold longer)
    ];

    try {
      for (const note of notes) {
        await this.playTone(note.freq, note.duration);
        // Small gap between notes
        await this.sleep(30);
      }

      // After first audio plays, softvol control exists - set the actual volume
      this.setVolume(this.currentVolume);
    } catch (err) {
      // Chime failed, not critical
      console.log(`   ⚠️  Startup chime failed`);
    }

    // Disable amplifier after chime (unless something else is playing)
    if (!this.isPlaying()) {
      this.setAmplifier(false);
    }
  }

  /**
   * Play a single tone using speaker-test
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
   * Simple sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
