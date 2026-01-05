/**
 * PlayerConfig - Configuration loader from JSON file or environment variables
 *
 * Config file locations (tried in order):
 * - ./player.config.json (development)
 * - /etc/musicbox/player.config.json (NixOS deployment)
 *
 * Environment variables (fallback if no config file):
 * - DEVICE_NAME: Unique identifier for this player device
 * - DEVICE_SECRET: Authentication secret (UUID)
 * - SERVER_URL: URL of the MusicBox server
 * - TRIGGER_KEYBOARD: Enable keyboard input (default: true)
 * - TRIGGER_HTTP: Enable HTTP API (default: false)
 * - HTTP_PORT: HTTP server port (default: 8080)
 * - TRIGGER_NFC: Enable NFC reader (default: false)
 * - NFC_I2C_BUS: I2C bus number for NFC reader (default: 1)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface PlayerConfig {
  deviceId: number;
  deviceName: string;
  deviceSecret: string;
  serverUrl: string;
  httpPort: number;
  triggers: {
    keyboard: {
      enabled: boolean;
    };
    http: {
      enabled: boolean;
      port: number;
    };
    nfc: {
      enabled: boolean;
      i2cBus: number;
    };
  };
}

export function loadConfig(): PlayerConfig {
  // Try to load from config file first
  const configPaths = [
    "./player.config.json",
    "/etc/musicbox/player.config.json", // NixOS location
    join(process.cwd(), "player.config.json"),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      console.log(`📄 Loading config from: ${configPath}`);
      const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));

      return {
        deviceId: fileConfig.deviceId,
        deviceName: fileConfig.deviceName,
        deviceSecret: fileConfig.deviceSecret,
        serverUrl: fileConfig.serverUrl,
        httpPort: fileConfig.httpPort || 8080,
        triggers: {
          keyboard: {
            enabled: process.env.TRIGGER_KEYBOARD !== "false",
          },
          http: {
            enabled: true, // Always enable for remote control when config file exists
            port: fileConfig.httpPort || 8080,
          },
          nfc: {
            enabled: process.env.TRIGGER_NFC === "true",
            i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10),
          },
        },
      };
    }
  }

  // Fall back to environment variables (development mode)
  console.log("⚠️  No config file found, using environment variables");
  return {
    deviceId: 0,
    deviceName: process.env.DEVICE_NAME || "dev-player",
    deviceSecret: process.env.DEVICE_SECRET || "",
    serverUrl: process.env.SERVER_URL || "http://localhost:3000",
    httpPort: parseInt(process.env.HTTP_PORT || "8080", 10),
    triggers: {
      keyboard: {
        enabled: process.env.TRIGGER_KEYBOARD !== "false",
      },
      http: {
        enabled: process.env.TRIGGER_HTTP === "true",
        port: parseInt(process.env.HTTP_PORT || "8080", 10),
      },
      nfc: {
        enabled: process.env.TRIGGER_NFC === "true",
        i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10),
      },
    },
  };
}
