/**
 * MusicBox Player - Main Entry Point
 *
 * Orchestrates the modular player architecture:
 * - Loads configuration from environment variables
 * - Initializes PlayerCore with server connection
 * - Registers and starts enabled triggers
 * - Handles graceful shutdown
 *
 * Usage:
 *   npm run dev                              # Keyboard trigger only
 *   TRIGGER_HTTP=true npm run dev            # Keyboard + HTTP
 *   TRIGGER_HTTP=true HTTP_PORT=3001 npm run dev  # Custom port
 */

import { PlayerCore } from "./core/PlayerCore.ts";
import { ServerClient } from "./api/ServerClient.ts";
import { KeyboardTrigger } from "./triggers/KeyboardTrigger.ts";
import { HTTPTrigger } from "./triggers/HTTPTrigger.ts";
import { NFCReaderTrigger } from "./triggers/NFCReaderTrigger.ts";
import { ButtonTrigger } from "./triggers/ButtonTrigger.ts";
import { HeartbeatService } from "./services/HeartbeatService.ts";
import { loadConfig } from "./config/PlayerConfig.ts";
import type { Trigger } from "./triggers/TriggerInterface.ts";

// Prevent process from exiting on unhandled errors
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
});

async function main() {
  console.log("🎵 MusicBox Player");
  console.log("═".repeat(60));

  const config = loadConfig();

  console.log(`📡 Device: ${config.deviceName}`);
  console.log(`🖥️  Server: ${config.serverUrl}`);
  console.log("═".repeat(60));

  // Initialize server client
  const serverClient = new ServerClient(config.serverUrl, config.deviceName);

  // Initialize player core (sets up audio engine and tone generator)
  const playerCore = new PlayerCore(serverClient);
  await playerCore.initialize();

  // Start heartbeat service (if device secret is configured)
  let heartbeatService: HeartbeatService | undefined;
  if (config.deviceSecret) {
    heartbeatService = new HeartbeatService(
      config.serverUrl,
      config.deviceSecret,
      playerCore
    );
    heartbeatService.start(30000); // Every 30 seconds
  } else {
    console.log("⚠️  No device secret configured - heartbeat disabled");
    console.log(
      "   Create a device in the server UI and deploy the config file"
    );
  }

  // Register enabled triggers
  const triggers: Trigger[] = [];

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
    console.error("❌ No triggers enabled!");
    console.error("   Enable at least one trigger via environment variables:");
    console.error("   - TRIGGER_KEYBOARD=true (default)");
    console.error("   - TRIGGER_HTTP=true");
    console.error("   - TRIGGER_NFC=true");
    process.exit(1);
  }

  // Start all triggers
  console.log(`\n🚀 Starting ${triggers.length} trigger(s)...`);
  for (const trigger of triggers) {
    try {
      await trigger.start(playerCore);
    } catch (error) {
      console.error(`❌ Failed to start ${trigger.name} trigger:`, error);
    }
  }

  // Play startup chime to indicate everything is ready
  playerCore.playReadyChime();
  console.log(""); // Add spacing after ready

  // Keep process alive - prevents exit if all triggers fail to initialize
  const keepalive = setInterval(() => {
    // This interval ensures the event loop stays active
  }, 60000);

  // Handle shutdown - be forceful
  let isShuttingDown = false;
  const shutdown = () => {
    if (isShuttingDown) {
      // Second Ctrl+C = immediate exit
      process.exit(0);
    }
    isShuttingDown = true;

    console.log("\n\n👋 Shutting down...");

    // Cleanup
    clearInterval(keepalive);
    heartbeatService?.stop();
    playerCore.stop();

    // Try to stop triggers but don't wait
    triggers.forEach((trigger) => {
      try {
        trigger.stop();
      } catch (err) {
        // Ignore errors
      }
    });

    // Exit immediately
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
