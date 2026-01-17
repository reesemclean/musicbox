/**
 * PlayerConfig - Configuration loader
 *
 * Config sources (in priority order):
 * 1. Boot partition files (agent-managed deployment):
 *    - /boot/firmware/musicbox/device.txt (device secret)
 *    - /boot/firmware/musicbox/config.txt (server URL)
 * 2. JSON config files:
 *    - ./player.config.json (development)
 *    - /etc/musicbox/player.config.json (legacy)
 * 3. Environment variables (development fallback)
 */

import { readFileSync, existsSync } from "fs";
import { hostname } from "os";
import { join } from "path";

// Boot partition paths (managed by agent)
// Note: On Raspberry Pi OS Bookworm, boot is at /boot/firmware/
const BOOT_SECRET_PATH = "/boot/firmware/musicbox/device.txt";
const BOOT_CONFIG_PATH = "/boot/firmware/musicbox/config.txt";

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
    buttons: {
      enabled: boolean;
    };
  };
}

/**
 * Load config from boot partition (agent-managed)
 */
function loadBootConfig(): { serverUrl: string; deviceSecret: string } | null {
  if (!existsSync(BOOT_SECRET_PATH)) {
    return null;
  }

  const deviceSecret = readFileSync(BOOT_SECRET_PATH, "utf-8").trim();
  if (!deviceSecret) {
    return null;
  }

  let serverUrl = "http://musicbox.local:3000";
  if (existsSync(BOOT_CONFIG_PATH)) {
    const configContent = readFileSync(BOOT_CONFIG_PATH, "utf-8");
    const match = configContent.match(/^SERVER_URL=(.+)$/m);
    if (match) {
      serverUrl = match[1].trim();
    }
  }

  return { serverUrl, deviceSecret };
}

export function loadConfig(): PlayerConfig {
  // First, try boot partition config (agent-managed deployment)
  const bootConfig = loadBootConfig();
  if (bootConfig) {
    console.log("📄 Loading config from boot partition (agent-managed)");
    return {
      deviceId: 0,
      deviceName: hostname(),
      deviceSecret: bootConfig.deviceSecret,
      serverUrl: bootConfig.serverUrl,
      httpPort: parseInt(process.env.HTTP_PORT || "8080", 10),
      triggers: {
        keyboard: {
          enabled: process.env.TRIGGER_KEYBOARD === "true",
        },
        http: {
          enabled: process.env.TRIGGER_HTTP !== "false",
          port: parseInt(process.env.HTTP_PORT || "8080", 10),
        },
        nfc: {
          enabled: process.env.TRIGGER_NFC !== "false",
          i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10),
        },
        buttons: {
          enabled: process.env.TRIGGER_BUTTONS !== "false",
        },
      },
    };
  }

  // Try to load from JSON config file (legacy/development)
  const configPaths = [
    "./player.config.json",
    "/etc/musicbox/player.config.json",
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
            enabled: true,
            port: fileConfig.httpPort || 8080,
          },
          nfc: {
            enabled: process.env.TRIGGER_NFC === "true",
            i2cBus: parseInt(process.env.NFC_I2C_BUS || "1", 10),
          },
          buttons: {
            enabled: process.env.TRIGGER_BUTTONS === "true",
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
      buttons: {
        enabled: process.env.TRIGGER_BUTTONS === "true",
      },
    },
  };
}
