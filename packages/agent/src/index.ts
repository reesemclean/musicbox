/**
 * MusicBox Agent - Main Entry Point
 *
 * Handles:
 * - First-boot device registration
 * - Configuration management
 * - Player updates
 * - State reporting
 */

import { loadLocalConfig, saveDeviceSecret } from "./config.js";
import { register, pollForApproval } from "./register.js";
import { fetchDesiredState } from "./state.js";
import { ensurePackages } from "./packages.js";
import { ensureFiles } from "./files.js";
import { ensurePlayer } from "./player.js";
import { ensureServices, restartService, reloadDaemon } from "./services.js";
import { reportState } from "./report.js";
import {
  getHardwareId,
  getHostname,
  setHostname,
  getAgentVersion,
  reboot,
} from "./system.js";

async function main() {
  console.log("MusicBox Agent starting...");

  const config = loadLocalConfig();
  console.log(`Server: ${config.serverUrl}`);

  // Check if device is registered
  if (!config.deviceSecret) {
    console.log("Device not registered, starting registration...");

    const hardwareId = await getHardwareId();
    const hostname = getHostname();

    console.log(`Hardware ID: ${hardwareId}`);
    console.log(`Hostname: ${hostname}`);

    const { deviceId } = await register(config.serverUrl, hardwareId, hostname);
    console.log(`Registered as device ${deviceId}, waiting for approval...`);

    const { secret, name } = await pollForApproval(config.serverUrl, deviceId);
    console.log(`Approved as "${name}"`);

    saveDeviceSecret(secret);
    config.deviceSecret = secret;

    // Set hostname to musicbox-<device-name>
    setHostname(name);
  }

  // Fetch desired state
  console.log("Fetching desired state from server...");
  const desired = await fetchDesiredState(
    config.serverUrl,
    config.deviceSecret
  );
  console.log(`  Config version: ${desired.configVersion || "none"}`);
  console.log(`  Player version: ${desired.player?.version || "none"}`);

  // Track what changed
  const changes: string[] = [];
  let needsReboot = false;

  // Ensure packages
  if (desired.system.packages.length > 0) {
    const packagesChanged = await ensurePackages(desired.system.packages);
    if (packagesChanged) {
      changes.push("packages");
    }
  }

  // Ensure files
  const filesChanged = await ensureFiles(desired.system.files);
  if (filesChanged.length > 0) {
    changes.push(...filesChanged.map((f) => `file:${f}`));

    // Check if boot config changed (requires reboot)
    // On Raspberry Pi OS Bookworm, boot config is at /boot/firmware/config.txt
    if (filesChanged.includes("/boot/firmware/config.txt")) {
      needsReboot = true;
    }

    // Check if systemd unit changed
    if (filesChanged.some((f) => f.includes("/etc/systemd/system/"))) {
      await reloadDaemon();
    }
  }

  // Ensure player
  if (desired.player) {
    const playerChanged = await ensurePlayer(
      config.serverUrl,
      desired.player.version,
      desired.player.url,
      desired.player.checksum
    );
    if (playerChanged) {
      changes.push("player");
    }
  }

  // Ensure services
  if (Object.keys(desired.services).length > 0) {
    await ensureServices(desired.services);
  }

  // Restart player if player or its config changed
  if (
    changes.includes("player") ||
    filesChanged.includes("/etc/systemd/system/musicbox-player.service")
  ) {
    console.log("Restarting player service...");
    try {
      await restartService("musicbox-player");
    } catch {
      console.log(
        "Note: Player service not running yet (expected on first install)"
      );
    }
  }

  // Report state (don't fail the agent if this fails)
  try {
    await reportState(config.serverUrl, config.deviceSecret, {
      configVersion: desired.configVersion || undefined,
      playerVersion: desired.player?.version,
      agentVersion: getAgentVersion(),
    });
  } catch (err) {
    console.error("Failed to report state (non-fatal):", err);
  }

  // Summary
  if (changes.length === 0) {
    console.log("System up to date, no changes needed");
  } else {
    console.log(`Applied changes: ${changes.join(", ")}`);
  }

  // Reboot if needed
  if (needsReboot) {
    console.log("Boot configuration changed, rebooting in 5 seconds...");
    setTimeout(() => reboot(), 5000);
  }

  console.log("Agent complete");
}

main().catch((err) => {
  console.error("Agent failed:", err);
  process.exit(1);
});
