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
  private consecutiveFailures = 0;
  private readonly maxBackoffMs = 300000; // Max 5 minutes between retries
  private readonly baseIntervalMs: number;

  constructor(serverUrl: string, deviceSecret: string, playerCore: PlayerCore) {
    this.serverUrl = serverUrl;
    this.deviceSecret = deviceSecret;
    this.playerCore = playerCore;
    this.baseIntervalMs = 30000;
  }

  /**
   * Start sending heartbeats
   * @param intervalMs - Interval in milliseconds (default: 30000 = 30s)
   */
  start(intervalMs: number = 30000) {
    // Send initial heartbeat immediately
    this.sendHeartbeat();

    // Schedule next heartbeat (will use backoff if needed)
    this.scheduleNextHeartbeat(intervalMs);

    console.log(`💓 Heartbeat service started (every ${intervalMs / 1000}s)`);
  }

  /**
   * Schedule the next heartbeat with exponential backoff on failures
   */
  private scheduleNextHeartbeat(baseInterval: number) {
    // Calculate delay with exponential backoff
    const backoffMultiplier = Math.min(
      Math.pow(2, this.consecutiveFailures),
      10
    );
    const delay = Math.min(baseInterval * backoffMultiplier, this.maxBackoffMs);

    this.interval = setTimeout(() => {
      this.sendHeartbeat();
      this.scheduleNextHeartbeat(baseInterval);
    }, delay);

    // Allow process to exit
    this.interval.unref();
  }

  /**
   * Stop sending heartbeats
   */
  stop() {
    if (this.interval) {
      clearTimeout(this.interval);
      this.interval = undefined;
      console.log("💓 Heartbeat service stopped");
    }
  }

  /**
   * Send a single heartbeat to the server
   */
  private async sendHeartbeat() {
    try {
      const status = await this.playerCore.getStatus();
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${this.serverUrl}/api/devices/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures === 1) {
          console.error(`❌ Heartbeat failed: ${response.status}`);
        }
      } else {
        if (this.consecutiveFailures > 0) {
          console.log(`💓 Server connection restored`);
        }
        this.consecutiveFailures = 0;
      }
    } catch (error) {
      this.consecutiveFailures++;
      // Only log first failure and then periodically
      if (this.consecutiveFailures === 1) {
        console.error(`❌ Server unreachable: ${this.serverUrl}`);
      } else if (this.consecutiveFailures % 10 === 0) {
        console.error(
          `❌ Server still unreachable (${this.consecutiveFailures} failures)`
        );
      }
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
