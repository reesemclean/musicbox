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
      // Set initial volume
      this.setVolume(this.currentVolume);
      console.log(`   🔊 Volume control initialized (${this.currentVolume}%)`);
    } catch (err) {
      console.log(`   ⚠️  Volume control not available`);
    }
  }

  /**
   * Detect available volume control method
   * Priority: pactl (PipeWire/PulseAudio) > amixer (ALSA)
   */
  private volumeMethod: "pactl" | "amixer" | "none" = "none";
  
  private detectVolumeControl(): void {
    try {
      // Try pactl first (works with PipeWire's PulseAudio compatibility)
      execSync("pactl --version", { stdio: "pipe" });
      this.volumeMethod = "pactl";
      console.log(`   🔊 Using PipeWire/PulseAudio volume control`);
      return;
    } catch {}

    try {
      // Fall back to amixer
      execSync("amixer --version", { stdio: "pipe" });
      this.volumeMethod = "amixer";
      console.log(`   🔊 Using ALSA volume control`);
      return;
    } catch {}

    this.volumeMethod = "none";
    console.log(`   ⚠️  No system volume control found, using ffplay filter`);
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
      // Use gpioset from libgpiod - it sets the pin and exits
      execSync(`gpioset gpiochip0 ${this.amplifierPin}=${value}`);
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

    // Enable amplifier before playing
    this.setAmplifier(true);

    console.log(`   🔊 Streaming audio... (volume: ${this.currentVolume}%)`);

    // Build ffplay args - use system volume control when available
    const ffplayArgs = [
      "-nodisp",
      "-autoexit",
      "-loglevel",
      "quiet",
      "-fflags",
      "nobuffer",
    ];

    // Only use ffplay volume filter as fallback when no system control
    if (this.volumeMethod === "none") {
      const volumeMultiplier = this.currentVolume / 100;
      ffplayArgs.push("-af", `volume=${volumeMultiplier}`);
    }

    ffplayArgs.push(streamUrl);

    // Try ffplay first (comes with ffmpeg), fall back to mpg123
    const players = [
      { cmd: "ffplay", args: ffplayArgs },
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
            // Disable amplifier when playback stops
            this.setAmplifier(false);
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
    // Disable amplifier when stopped
    this.setAmplifier(false);
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

  /**
   * Set volume level - applies immediately to current and future playback
   * @param percent - Volume level 0-100
   */
  setVolume(percent: number): void {
    // Clamp to 0-100
    percent = Math.max(0, Math.min(100, percent));
    this.currentVolume = percent;

    // Apply volume immediately using system volume control
    switch (this.volumeMethod) {
      case "pactl":
        try {
          // Set all sinks to the specified volume (PipeWire/PulseAudio)
          // This affects audio in real-time
          execSync(`pactl set-sink-volume @DEFAULT_SINK@ ${percent}%`, { stdio: "pipe" });
          console.log(`🔊 Volume: ${percent}%`);
        } catch (err) {
          console.log(`⚠️  pactl volume failed, trying amixer`);
          this.tryAmixerVolume(percent);
        }
        break;

      case "amixer":
        this.tryAmixerVolume(percent);
        break;

      default:
        // No system control - volume applied via ffplay filter on next play
        console.log(`🔊 Volume set to ${percent}% (applies on next song)`);
    }
  }

  /**
   * Try setting volume via ALSA amixer
   */
  private tryAmixerVolume(percent: number): void {
    // Try common mixer control names
    const controls = ["PCM", "Master", "Speaker", "Headphone"];
    
    for (const control of controls) {
      try {
        execSync(`amixer -q sset ${control} ${percent}%`, { stdio: "pipe" });
        console.log(`🔊 Volume: ${percent}%`);
        return;
      } catch {}
    }
    console.log(`⚠️  ALSA volume control failed`);
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
}
