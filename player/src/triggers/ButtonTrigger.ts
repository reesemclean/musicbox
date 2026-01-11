/**
 * ButtonTrigger - Physical button controls via GPIO using libgpiod
 *
 * Provides hardware button support for:
 * - Play/Pause toggle
 * - Volume up/down
 * - Next/previous track
 *
 * Uses libgpiod (gpiomon) for modern GPIO access instead of deprecated sysfs.
 * Buttons should be wired between GPIO pin and GND (pull-up resistors enabled).
 */

import { spawn, execSync, ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { Trigger } from "./TriggerInterface.ts";
import type { PlayerCore } from "../core/PlayerCore.ts";

interface ButtonConfig {
  pin: number;
  action: "play-pause" | "volume-up" | "volume-down" | "next" | "previous";
  label: string;
}

export class ButtonTrigger implements Trigger {
  readonly name = "buttons";
  private playerCore?: PlayerCore;
  private buttons: ButtonConfig[] = [
    { pin: 5, action: "play-pause", label: "Play/Pause" },
    { pin: 6, action: "volume-up", label: "Volume Up" },
    { pin: 13, action: "volume-down", label: "Volume Down" },
    { pin: 16, action: "next", label: "Next Track" },
    { pin: 26, action: "previous", label: "Previous Track" },
  ];
  private monitorProcess?: ChildProcess;
  private lastPressTime = new Map<number, number>();
  private readonly debounceMs = 200; // Debounce delay
  private gpiochip = "gpiochip0"; // Default GPIO chip

  async start(playerCore: PlayerCore): Promise<void> {
    this.playerCore = playerCore;

    // Check if GPIO chip exists
    if (!existsSync(`/dev/${this.gpiochip}`)) {
      console.log(
        `⚠️  GPIO chip not found (/dev/${this.gpiochip}) - button trigger disabled`
      );
      return;
    }

    // Check if gpiomon is available by trying to run it
    try {
      execSync("gpiomon --version", { stdio: "pipe" });
    } catch {
      console.log("⚠️  gpiomon not found - button trigger disabled");
      console.log("   Install libgpiod package");
      console.log(`   PATH: ${process.env.PATH}`);
      return;
    }

    console.log(`🎮 Button trigger initializing (libgpiod)...`);

    // Log button mappings
    for (const button of this.buttons) {
      console.log(`   - GPIO ${button.pin}: ${button.label}`);
    }

    // Build list of pin offsets as positional arguments
    const pinArgs = this.buttons.map((b) => String(b.pin));

    // Start gpiomon to watch all button pins for falling edges (button press)
    // libgpiod v2 syntax:
    //   gpiomon -c <chip> -b pull-up -e falling <line> [<line>...]
    try {
      this.monitorProcess = spawn(
        "gpiomon",
        [
          "-c",
          this.gpiochip, // --chip
          "-b",
          "pull-up", // --bias
          "-e",
          "falling", // --edges
          ...pinArgs, // line offsets as positional args
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      this.monitorProcess.stdout?.on("data", (data: Buffer) => {
        this.handleGpioEvent(data.toString());
      });

      this.monitorProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) {
          console.log(`⚠️  gpiomon error: ${msg}`);
        }
      });

      this.monitorProcess.on("error", (err) => {
        console.log(`⚠️  gpiomon process error: ${err.message}`);
      });

      this.monitorProcess.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.log(`⚠️  gpiomon exited with code ${code}`);
        }
      });
    } catch (err) {
      console.log(`⚠️  Failed to start button monitoring: ${err}`);
    }
  }

  /**
   * Handle GPIO event from gpiomon output
   * Output format varies by libgpiod version:
   * v1.x: "offset timestamp event_type"
   * v2.x: "chip line timestamp event_type"
   */
  private handleGpioEvent(data: string): void {
    const lines = data.trim().split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse the event - try to extract the GPIO offset/line number
      const parts = line.trim().split(/\s+/);
      let pin: number | undefined;

      // Try to find the pin number - it's usually the first or second number
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num) && this.buttons.some((b) => b.pin === num)) {
          pin = num;
          break;
        }
      }

      if (pin !== undefined) {
        this.handleButtonPress(pin);
      }
    }
  }

  /**
   * Handle button press with debouncing
   */
  private handleButtonPress(pin: number): void {
    const now = Date.now();
    const lastPress = this.lastPressTime.get(pin) || 0;

    // Debounce - ignore if pressed too recently
    if (now - lastPress < this.debounceMs) {
      return;
    }

    this.lastPressTime.set(pin, now);

    const button = this.buttons.find((b) => b.pin === pin);
    if (!button) return;

    console.log(`🎮 Button pressed: ${button.label}`);
    this.executeAction(button.action);
  }

  /**
   * Execute the button's action
   */
  private executeAction(
    action: "play-pause" | "volume-up" | "volume-down" | "next" | "previous"
  ): void {
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

  async stop(): Promise<void> {
    if (this.monitorProcess) {
      this.monitorProcess.kill("SIGTERM");
      this.monitorProcess = undefined;
    }

    console.log("\n🎮 Button trigger stopped");
  }
}
