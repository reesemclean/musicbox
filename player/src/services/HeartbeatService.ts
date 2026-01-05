/**
 * HeartbeatService - Sends periodic heartbeats to server with device status
 *
 * Responsibilities:
 * - Send heartbeat to /api/devices/heartbeat every 30s
 * - Include current IP address
 * - Include current playback status (optional)
 * - Auto-detect local IP address
 */

import type { PlayerCore } from "../core/PlayerCore.ts";
import { networkInterfaces } from "os";

export class HeartbeatService {
  private interval?: NodeJS.Timeout;
  private serverUrl: string;
  private deviceSecret: string;
  private playerCore: PlayerCore;

  constructor(serverUrl: string, deviceSecret: string, playerCore: PlayerCore) {
    this.serverUrl = serverUrl;
    this.deviceSecret = deviceSecret;
    this.playerCore = playerCore;
  }

  /**
   * Start sending heartbeats
   * @param intervalMs - Interval in milliseconds (default: 30000 = 30s)
   */
  start(intervalMs: number = 30000) {
    // Send initial heartbeat immediately
    this.sendHeartbeat();

    // Then send every intervalMs
    this.interval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);

    // Allow process to exit even with interval running
    this.interval.unref();

    console.log(`💓 Heartbeat service started (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop sending heartbeats
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      console.log("💓 Heartbeat service stopped");
    }
  }

  /**
   * Send a single heartbeat to the server
   */
  private async sendHeartbeat() {
    try {
      const status = this.playerCore.getStatus();
      const ipAddress = this.getLocalIPAddress();

      const payload: {
        secret: string;
        ipAddress: string;
        currentSong?: { title: string; artist?: string; isPlaying: boolean };
      } = {
        secret: this.deviceSecret,
        ipAddress,
      };

      // Include current song if playing
      if (status.currentSong) {
        payload.currentSong = {
          title: status.currentSong.title,
          artist: status.currentSong.artist || undefined,
          isPlaying: status.isPlaying,
        };
      }

      const response = await fetch(`${this.serverUrl}/api/devices/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`❌ Heartbeat failed: ${response.status}`);
      }
    } catch (error) {
      console.error("❌ Heartbeat error:", error);
    }
  }

  /**
   * Get the local IP address of this device
   * @returns IP address string or 'unknown'
   */
  private getLocalIPAddress(): string {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
      const netInterface = nets[name];
      if (!netInterface) continue;

      for (const net of netInterface) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (net.family === "IPv4" && !net.internal) {
          return net.address;
        }
      }
    }

    return "unknown";
  }
}
