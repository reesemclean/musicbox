# MusicBox Device Management

## Overview

This document describes the architecture for managing MusicBox player devices, including:
- Initial device provisioning (bootstrap)
- Over-the-air updates for player software
- System configuration management
- Device fleet visibility

## Goals

1. **Reproducible** - Flash an SD card, boot, approve in UI, done
2. **Updatable** - Push player and config updates without reflashing
3. **Lightweight** - Raspberry Pi OS Lite instead of NixOS
4. **Centralized** - Server is single source of truth for all device config

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MusicBox Server                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Existing:                      New:                                     │
│  ├── Card/playlist management   ├── Device registration & approval      │
│  ├── Audio streaming            ├── Desired state API                   │
│  └── Web UI                     ├── Release management (player/agent)   │
│                                 ├── System config management             │
│                                 └── Device fleet dashboard               │
│                                                                          │
│  Builds & Hosts:                                                         │
│  ├── player.tar.gz   (player application bundle)                        │
│  └── agent.tar.gz    (config agent bundle)                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           MusicBox Device                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Base OS: Raspberry Pi OS Lite (64-bit)                                 │
│                                                                          │
│  Pre-installed:                                                          │
│  ├── System packages (mpv, alsa-utils, i2c-tools, libgpiod, nodejs)    │
│  ├── Config agent (/opt/musicbox/agent/)                                │
│  └── Systemd services (musicbox-agent, musicbox-player)                 │
│                                                                          │
│  Managed by agent:                                                       │
│  ├── Player application (/opt/musicbox/player/)                         │
│  ├── System config files (/boot/config.txt, /etc/asound.conf)          │
│  └── Service state                                                       │
│                                                                          │
│  Hardware:                                                               │
│  ├── MAX98357A DAC (I2S audio)                                          │
│  ├── PN532 NFC reader (I2C)                                             │
│  └── GPIO buttons                                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Server (existing, enhanced)

The existing MusicBox server gains new responsibilities:

| Feature | Description |
|---------|-------------|
| Device Registry | Track all devices, their status, versions |
| Registration API | Accept new device registrations |
| Approval Flow | UI for approving pending devices |
| Desired State API | Serve configuration to devices |
| Release Management | Store and serve player/agent bundles |
| Config Management | Manage system config (packages, files) |
| Fleet Dashboard | View all devices, their status, push updates |

### 2. Player (existing, repackaged)

The existing player application, packaged as a tarball for deployment:

```
player.tar.gz
├── dist/
│   └── index.js          # Bundled player application
├── package.json
└── node_modules/         # Production dependencies only
```

The server builds this from the player source and serves it to devices.

### 3. Agent (new)

A lightweight TypeScript application that runs on each device:

```
agent/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Load local config (server URL, device secret)
│   ├── register.ts       # First-boot registration flow
│   ├── state.ts          # Fetch desired state from server
│   ├── packages.ts       # Ensure apt packages installed
│   ├── files.ts          # Ensure config files match desired state
│   ├── services.ts       # Manage systemd services
│   ├── player.ts         # Download and install player updates
│   └── report.ts         # Report device state to server
├── package.json
└── tsconfig.json
```

**Responsibilities:**
- First-boot device registration
- Poll for and apply configuration updates
- Download and install player updates
- Report device state to server

---

## Device Lifecycle

### Phase 1: Image Creation (one-time)

Build a base Raspberry Pi OS image with:

```
Base Image Contents:
├── Raspberry Pi OS Lite (64-bit)
├── System packages pre-installed:
│   ├── nodejs (v22 LTS)
│   ├── mpv
│   ├── alsa-utils
│   ├── i2c-tools
│   └── libgpiod
├── Hardware configuration:
│   ├── /boot/config.txt (I2S overlay, I2C enabled)
│   └── /etc/asound.conf (ALSA dmix config)
├── Agent pre-installed:
│   └── /opt/musicbox/agent/
├── Systemd services:
│   ├── musicbox-agent.service
│   ├── musicbox-agent.timer
│   └── musicbox-player.service
├── First-boot configuration:
│   └── /boot/musicbox/ (user-editable config directory)
└── Default server URL baked in
```

**Tools:** Use `pi-gen` or similar to create reproducible images.

### Phase 2: Device Preparation

User prepares SD card:

1. Flash base image to SD card
2. Mount boot partition (FAT32, readable on any OS)
3. Edit `/boot/musicbox/wifi.txt`:
   ```
   SSID=MyNetwork
   PASSWORD=MyPassword
   COUNTRY=US
   ```
4. Optionally edit `/boot/musicbox/config.txt`:
   ```
   SERVER_URL=http://musicbox.local:3000
   ```
5. Insert SD card into device, power on

### Phase 3: First Boot

```
┌─────────────────────────────────────────────────────────────┐
│ Device                               Server                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. Boot, connect to WiFi                                    │
│                                                              │
│ 2. Agent starts, detects no device secret                   │
│                                                              │
│ 3. Agent reads hardware ID (CPU serial)                     │
│                                                              │
│ 4. POST /api/devices/register ─────────────────────────────▶│
│    { hardwareId: "1000000012345678",                        │
│      hostname: "raspberrypi" }                              │
│                                                              │
│                                      Creates device record   │
│                                      status = "pending"      │
│                                                              │
│◀─────────────────────────────────── { deviceId: 7,          │
│                                        status: "pending" }   │
│                                                              │
│ 5. Agent polls waiting for approval...                      │
│                                                              │
│    GET /api/devices/register/7/status ─────────────────────▶│
│◀─────────────────────────────────── { status: "pending" }   │
│                                                              │
│    (repeat every 5 seconds)                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 4: Admin Approval

Admin sees pending device in server UI:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  New Device Pending Approval                             │
│                                                              │
│ Hardware ID: 1000000012345678                               │
│ Hostname: raspberrypi                                        │
│ First seen: 2 minutes ago                                   │
│                                                              │
│ Device Name: [Living Room________]                          │
│                                                              │
│ [Approve]  [Reject]                                         │
└─────────────────────────────────────────────────────────────┘
```

On approval:
1. Server generates device secret (UUID)
2. Server sets device status to "approved"
3. Device's next poll receives the secret

### Phase 5: Configuration Applied

```
┌─────────────────────────────────────────────────────────────┐
│ Device                               Server                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. Receives approval + secret                               │
│                                                              │
│ 2. Saves secret to /boot/musicbox/device.txt               │
│                                                              │
│ 3. GET /api/devices/by-secret/:secret/desired-state ───────▶│
│                                                              │
│◀─────────────────────────────────── {                       │
│                                        configVersion: "...", │
│                                        system: { ... },      │
│                                        player: { ... }       │
│                                      }                       │
│                                                              │
│ 4. Agent applies desired state:                             │
│    - Verify packages installed                              │
│    - Update config files if changed                         │
│    - Download player if version differs                     │
│    - Restart services as needed                             │
│                                                              │
│ 5. POST /api/devices/by-secret/:secret/state ──────────────▶│
│    { configVersion, playerVersion, ip, ... }                │
│                                                              │
│ 6. Start player service                                     │
│                                                              │
│ 7. 🎵 Startup chime - ready!                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Phase 6: Ongoing Updates

The agent runs periodically (via systemd timer) to check for updates:

```
┌─────────────────────────────────────────────────────────────┐
│ Every hour (or on-demand trigger):                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. Fetch desired state from server                          │
│                                                              │
│ 2. Compare with current state:                              │
│    - Config version changed? → Apply new config files       │
│    - Player version changed? → Download and install         │
│    - Packages changed? → apt install                        │
│                                                              │
│ 3. Restart services if needed                               │
│                                                              │
│ 4. Report new state to server                               │
│                                                              │
│ 5. Reboot if /boot/config.txt changed                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Server API

### Device Registration

#### POST /api/devices/register

Register a new device (called on first boot).

**Request:**
```json
{
  "hardwareId": "1000000012345678",
  "hostname": "raspberrypi"
}
```

**Response:**
```json
{
  "deviceId": 7,
  "status": "pending"
}
```

#### GET /api/devices/register/:deviceId/status

Check registration status (device polls this).

**Response (pending):**
```json
{
  "status": "pending"
}
```

**Response (approved):**
```json
{
  "status": "approved",
  "secret": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Living Room"
}
```

**Response (rejected):**
```json
{
  "status": "rejected"
}
```

### Device Management (authenticated)

#### POST /api/devices/:deviceId/approve

Approve a pending device.

**Request:**
```json
{
  "name": "Living Room"
}
```

#### POST /api/devices/:deviceId/reject

Reject a pending device.

### Desired State

#### GET /api/devices/by-secret/:secret/desired-state

Get the desired configuration for a device.

**Response:**
```json
{
  "configVersion": "2024-01-15-001",
  "system": {
    "packages": [
      "mpv",
      "alsa-utils",
      "i2c-tools",
      "libgpiod"
    ],
    "files": {
      "/boot/config.txt": {
        "content": "# MusicBox device config\ndtoverlay=max98357a\ndtparam=i2c_arm=on\n...",
        "checksum": "sha256:abc123..."
      },
      "/etc/asound.conf": {
        "content": "pcm.dmixer { ... }",
        "checksum": "sha256:def456..."
      },
      "/etc/systemd/system/musicbox-player.service": {
        "content": "[Unit]\nDescription=MusicBox Player\n...",
        "checksum": "sha256:789xyz..."
      }
    }
  },
  "player": {
    "version": "1.2.3",
    "url": "/api/releases/player-1.2.3.tar.gz",
    "checksum": "sha256:fedcba..."
  },
  "services": {
    "musicbox-player": {
      "enabled": true
    }
  }
}
```

### State Reporting

#### POST /api/devices/by-secret/:secret/state

Report current device state.

**Request:**
```json
{
  "configVersion": "2024-01-15-001",
  "playerVersion": "1.2.3",
  "agentVersion": "1.0.0",
  "ip": "192.168.1.50",
  "hostname": "musicbox-living-room",
  "uptime": 86400,
  "lastError": null
}
```

### Releases

#### GET /api/releases/player-:version.tar.gz

Download a player release tarball.

#### GET /api/releases/agent-:version.tar.gz

Download an agent release tarball.

#### POST /api/releases (authenticated)

Upload a new release.

**Request:** Multipart form with tarball file.

#### POST /api/releases/:type/:version/activate (authenticated)

Set a release as the active version.

---

## Database Schema

### New Tables

```sql
-- Extend existing devices table
ALTER TABLE devices ADD COLUMN hardware_id TEXT UNIQUE;
ALTER TABLE devices ADD COLUMN status TEXT DEFAULT 'pending';
  -- Values: 'pending', 'approved', 'rejected'
ALTER TABLE devices ADD COLUMN approved_at DATETIME;
ALTER TABLE devices ADD COLUMN last_seen_at DATETIME;
ALTER TABLE devices ADD COLUMN last_ip TEXT;
ALTER TABLE devices ADD COLUMN reported_player_version TEXT;
ALTER TABLE devices ADD COLUMN reported_agent_version TEXT;
ALTER TABLE devices ADD COLUMN reported_config_version TEXT;

-- System configuration versions
CREATE TABLE system_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  description TEXT,
  packages TEXT NOT NULL,          -- JSON array
  files TEXT NOT NULL,             -- JSON object
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE
);

-- Player and agent releases
CREATE TABLE releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- 'player' or 'agent'
  version TEXT NOT NULL,
  filename TEXT NOT NULL,
  checksum TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE,
  UNIQUE(type, version)
);
```

---

## File Locations

### On Server

```
server/
├── data/
│   ├── musicbox.db              # SQLite database
│   └── releases/                # Release tarballs
│       ├── player-1.2.3.tar.gz
│       ├── player-1.2.2.tar.gz
│       ├── agent-1.0.0.tar.gz
│       └── ...
└── ...
```

### On Device

```
/boot/musicbox/                   # User-editable (FAT32 partition)
├── wifi.txt                      # WiFi credentials
├── config.txt                    # Server URL override
└── device.txt                    # Device secret (written after approval)

/opt/musicbox/                    # Application directory
├── agent/                        # Config agent
│   ├── dist/
│   │   └── index.js
│   ├── package.json
│   └── node_modules/
└── player/                       # Player application
    ├── dist/
    │   └── index.js
    ├── package.json
    └── node_modules/

/var/cache/musicbox/              # Audio cache
└── *.opus, *.mp3, ...

/etc/asound.conf                  # ALSA configuration (managed by agent)

/etc/systemd/system/
├── musicbox-agent.service        # Agent service
├── musicbox-agent.timer          # Agent periodic trigger
└── musicbox-player.service       # Player service (managed by agent)
```

---

## Build & Release Process

### Building Releases

The server (or CI pipeline) builds releases:

```bash
# Build player release
cd player
npm ci
npm run build
tar -czvf ../server/data/releases/player-1.2.3.tar.gz \
  dist/ package.json package-lock.json

# Build agent release
cd agent
npm ci
npm run build
tar -czvf ../server/data/releases/agent-1.0.0.tar.gz \
  dist/ package.json package-lock.json
```

### Activating a Release

1. Upload release via server UI or API
2. Mark release as "active"
3. Devices pick up new version on next check
4. Server dashboard shows rollout progress

### Rollback

1. Mark previous release as "active"
2. Devices automatically downgrade on next check

---

## Security Considerations

### Device Authentication

- Each approved device has a unique secret (UUID)
- Secret is used to authenticate all device→server requests
- Secret stored locally in `/boot/musicbox/device.txt`

### Server Authentication

- Admin UI requires authentication for:
  - Device approval/rejection
  - Release management
  - Config changes
- Device-facing APIs only require device secret

### Network Security

- All communication should use HTTPS in production
- Device secrets should be treated as sensitive credentials

---

## Future Considerations

### Not in Initial Scope

- Per-device configuration overrides
- Staged rollouts (canary deployments)
- Automatic rollback on errors
- Remote shell/debugging access
- Metrics collection (CPU, memory, etc.)

These can be added later as needed.

---

## Implementation Order

### Phase 1: Server API
1. Device registration endpoints
2. Desired state endpoint
3. State reporting endpoint
4. Database schema changes

### Phase 2: Server UI
1. Pending devices view
2. Device approval flow
3. Device fleet dashboard

### Phase 3: Agent
1. Registration flow
2. Desired state fetching
3. Package management
4. File management
5. Player updates
6. Service management

### Phase 4: Release Management
1. Release upload endpoint
2. Release storage
3. Release activation
4. Server UI for releases

### Phase 5: Base Image
1. pi-gen configuration
2. Pre-installed packages
3. Agent installation
4. Systemd services
5. Default configuration

### Phase 6: Config Management UI
1. System config editor
2. Config versioning
3. Config deployment

---

## Appendix A: Hardware Configuration

### /boot/config.txt

```ini
# MusicBox Device Configuration

# Disable unused interfaces to save resources
dtoverlay=disable-bt
dtoverlay=disable-wifi  # Remove if using WiFi (we are)

# Enable I2S audio output (MAX98357A DAC)
dtoverlay=max98357a

# Enable I2C for NFC reader (PN532)
dtparam=i2c_arm=on
dtparam=i2c_arm_baudrate=100000

# Disable onboard audio (conflicts with I2S)
dtparam=audio=off

# GPU memory (minimum for headless)
gpu_mem=16

# Disable splash screen for faster boot
disable_splash=1

# Console settings
enable_uart=1
```

### /etc/asound.conf

```conf
# MusicBox ALSA Configuration
# MAX98357A I2S DAC with dmix for mixing multiple audio sources

# Hardware dmix - allows multiple apps to share the audio device
pcm.dmixer {
  type dmix
  ipc_key 1024
  ipc_perm 0666
  slave {
    pcm "hw:0,0"
    period_time 0
    period_size 1024
    buffer_size 4096
    rate 44100
  }
}

# Software volume control on top of dmix
pcm.softvol {
  type softvol
  slave.pcm "dmixer"
  control {
    name "Master"
    card 0
  }
  min_dB -51.0
  max_dB 0.0
}

# Default output - goes through softvol and dmix
pcm.!default {
  type plug
  slave.pcm "softvol"
}

# Default control device
ctl.!default {
  type hw
  card 0
}
```

---

## Appendix B: Systemd Services

### /etc/systemd/system/musicbox-agent.service

```ini
[Unit]
Description=MusicBox Config Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/node /opt/musicbox/agent/dist/index.js
User=root
Environment=NODE_ENV=production

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=musicbox-agent

[Install]
WantedBy=multi-user.target
```

### /etc/systemd/system/musicbox-agent.timer

```ini
[Unit]
Description=Run MusicBox Config Agent periodically

[Timer]
OnBootSec=1min
OnUnitActiveSec=1h
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
```

### /etc/systemd/system/musicbox-player.service

```ini
[Unit]
Description=MusicBox Player
After=network-online.target sound.target
Wants=network-online.target sound.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/musicbox/player/dist/index.js
User=musicbox
Group=musicbox
Restart=always
RestartSec=10

# Environment
Environment=NODE_ENV=production
Environment=TRIGGER_KEYBOARD=false
Environment=TRIGGER_HTTP=true
Environment=TRIGGER_NFC=true
Environment=TRIGGER_BUTTONS=true

# Permissions for hardware access
SupplementaryGroups=audio i2c gpio

# Paths
WorkingDirectory=/opt/musicbox/player
ReadWritePaths=/var/cache/musicbox /tmp

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=musicbox-player

[Install]
WantedBy=multi-user.target
```

---

## Appendix C: Agent Implementation

### Entry Point (src/index.ts)

```typescript
import { loadLocalConfig, saveDeviceSecret } from "./config.js";
import { register, pollForApproval } from "./register.js";
import { fetchDesiredState } from "./state.js";
import { ensurePackages } from "./packages.js";
import { ensureFiles } from "./files.js";
import { ensurePlayer } from "./player.js";
import { ensureServices, restartService } from "./services.js";
import { reportState } from "./report.js";
import { getHardwareId, reboot } from "./system.js";

async function main() {
  console.log("🔧 MusicBox Agent starting...");

  const config = loadLocalConfig();

  // Check if device is registered
  if (!config.deviceSecret) {
    console.log("📝 Device not registered, starting registration...");

    const hardwareId = await getHardwareId();
    const hostname = (await import("os")).hostname();

    const { deviceId } = await register(config.serverUrl, hardwareId, hostname);
    console.log(`⏳ Registered as device ${deviceId}, waiting for approval...`);

    const { secret, name } = await pollForApproval(config.serverUrl, deviceId);
    console.log(`✅ Approved as "${name}"`);

    await saveDeviceSecret(secret);
    config.deviceSecret = secret;
  }

  // Fetch desired state
  console.log("📡 Fetching desired state from server...");
  const desired = await fetchDesiredState(config.serverUrl, config.deviceSecret);
  console.log(`   Config version: ${desired.configVersion}`);
  console.log(`   Player version: ${desired.player.version}`);

  // Track what changed
  const changes: string[] = [];
  let needsReboot = false;

  // Ensure packages
  const packagesChanged = await ensurePackages(desired.system.packages);
  if (packagesChanged) {
    changes.push("packages");
  }

  // Ensure files
  const filesChanged = await ensureFiles(desired.system.files);
  if (filesChanged.length > 0) {
    changes.push(...filesChanged.map(f => `file:${f}`));

    // Check if boot config changed (requires reboot)
    if (filesChanged.includes("/boot/config.txt")) {
      needsReboot = true;
    }

    // Check if systemd unit changed
    if (filesChanged.some(f => f.includes("/etc/systemd/system/"))) {
      console.log("🔄 Reloading systemd daemon...");
      await import("child_process").then(cp =>
        cp.execSync("systemctl daemon-reload")
      );
    }
  }

  // Ensure player
  const playerChanged = await ensurePlayer(
    config.serverUrl,
    desired.player.version,
    desired.player.url,
    desired.player.checksum
  );
  if (playerChanged) {
    changes.push("player");
  }

  // Ensure services
  await ensureServices(desired.services);

  // Restart player if player or its config changed
  if (playerChanged || filesChanged.includes("/etc/systemd/system/musicbox-player.service")) {
    console.log("🔄 Restarting player service...");
    await restartService("musicbox-player");
  }

  // Report state
  await reportState(config.serverUrl, config.deviceSecret, {
    configVersion: desired.configVersion,
    playerVersion: desired.player.version,
    agentVersion: getAgentVersion(),
  });

  // Summary
  if (changes.length === 0) {
    console.log("✅ System up to date, no changes needed");
  } else {
    console.log(`✅ Applied changes: ${changes.join(", ")}`);
  }

  // Reboot if needed
  if (needsReboot) {
    console.log("🔄 Boot configuration changed, rebooting in 5 seconds...");
    setTimeout(() => reboot(), 5000);
  }
}

main().catch((err) => {
  console.error("❌ Agent failed:", err);
  process.exit(1);
});
```

### Key Modules

#### src/config.ts
```typescript
import { existsSync, readFileSync, writeFileSync } from "fs";

const BOOT_CONFIG_PATH = "/boot/musicbox/config.txt";
const DEVICE_SECRET_PATH = "/boot/musicbox/device.txt";
const DEFAULT_SERVER_URL = "http://musicbox.local:3000";

export interface LocalConfig {
  serverUrl: string;
  deviceSecret: string | null;
}

export function loadLocalConfig(): LocalConfig {
  let serverUrl = DEFAULT_SERVER_URL;
  let deviceSecret: string | null = null;

  // Load server URL override
  if (existsSync(BOOT_CONFIG_PATH)) {
    const content = readFileSync(BOOT_CONFIG_PATH, "utf-8");
    const match = content.match(/^SERVER_URL=(.+)$/m);
    if (match) {
      serverUrl = match[1].trim();
    }
  }

  // Load device secret if exists
  if (existsSync(DEVICE_SECRET_PATH)) {
    deviceSecret = readFileSync(DEVICE_SECRET_PATH, "utf-8").trim();
  }

  return { serverUrl, deviceSecret };
}

export function saveDeviceSecret(secret: string): void {
  writeFileSync(DEVICE_SECRET_PATH, secret, { mode: 0o600 });
}
```

#### src/packages.ts
```typescript
import { execSync } from "child_process";

export async function ensurePackages(packages: string[]): Promise<boolean> {
  const missing: string[] = [];

  for (const pkg of packages) {
    try {
      execSync(`dpkg -s ${pkg} 2>/dev/null | grep -q "Status: install ok"`, {
        stdio: "pipe",
      });
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) {
    return false;
  }

  console.log(`📦 Installing packages: ${missing.join(", ")}`);
  execSync(`apt-get update && apt-get install -y ${missing.join(" ")}`, {
    stdio: "inherit",
  });

  return true;
}
```

#### src/files.ts
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";

interface FileSpec {
  content: string;
  checksum: string;
}

export async function ensureFiles(
  files: Record<string, FileSpec>
): Promise<string[]> {
  const changed: string[] = [];

  for (const [path, spec] of Object.entries(files)) {
    let currentChecksum: string | null = null;

    if (existsSync(path)) {
      const content = readFileSync(path);
      currentChecksum = "sha256:" + createHash("sha256").update(content).digest("hex");
    }

    if (currentChecksum !== spec.checksum) {
      console.log(`📝 Updating file: ${path}`);

      // Ensure directory exists
      const dir = dirname(path);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(path, spec.content, { mode: 0o644 });
      changed.push(path);
    }
  }

  return changed;
}
```

#### src/player.ts
```typescript
import { existsSync, readFileSync, mkdirSync, createWriteStream, rmSync } from "fs";
import { execSync } from "child_process";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const PLAYER_DIR = "/opt/musicbox/player";
const VERSION_FILE = `${PLAYER_DIR}/.version`;

export async function ensurePlayer(
  serverUrl: string,
  version: string,
  url: string,
  checksum: string
): Promise<boolean> {
  // Check current version
  let currentVersion: string | null = null;
  if (existsSync(VERSION_FILE)) {
    currentVersion = readFileSync(VERSION_FILE, "utf-8").trim();
  }

  if (currentVersion === version) {
    return false;
  }

  console.log(`📥 Downloading player ${version}...`);

  // Download tarball
  const downloadUrl = url.startsWith("http") ? url : `${serverUrl}${url}`;
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download player: ${response.status}`);
  }

  const tarballPath = "/tmp/player.tar.gz";
  const writeStream = createWriteStream(tarballPath);
  await pipeline(Readable.fromWeb(response.body as any), writeStream);

  // TODO: Verify checksum

  // Extract
  console.log(`📦 Installing player ${version}...`);

  // Backup old version
  if (existsSync(PLAYER_DIR)) {
    rmSync(PLAYER_DIR, { recursive: true });
  }
  mkdirSync(PLAYER_DIR, { recursive: true });

  execSync(`tar -xzf ${tarballPath} -C ${PLAYER_DIR}`, { stdio: "inherit" });

  // Install dependencies
  execSync(`cd ${PLAYER_DIR} && npm ci --omit=dev`, { stdio: "inherit" });

  // Write version file
  require("fs").writeFileSync(VERSION_FILE, version);

  // Cleanup
  rmSync(tarballPath);

  return true;
}
```

---

## Appendix D: WiFi Configuration

### First-boot WiFi setup

The agent (or a separate first-boot script) reads `/boot/musicbox/wifi.txt` and configures WiFi:

### /boot/musicbox/wifi.txt
```
SSID=MyNetwork
PASSWORD=MyPassword
COUNTRY=US
```

### First-boot script (/opt/musicbox/first-boot.sh)
```bash
#!/bin/bash
# Run once on first boot to configure WiFi

WIFI_CONFIG="/boot/musicbox/wifi.txt"
WPA_CONF="/etc/wpa_supplicant/wpa_supplicant.conf"

if [ -f "$WIFI_CONFIG" ]; then
  source "$WIFI_CONFIG"

  if [ -n "$SSID" ] && [ -n "$PASSWORD" ]; then
    echo "Configuring WiFi for SSID: $SSID"

    cat > "$WPA_CONF" <<EOF
country=${COUNTRY:-US}
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
  ssid="$SSID"
  psk="$PASSWORD"
}
EOF

    # Restart networking
    systemctl restart wpa_supplicant
    systemctl restart dhcpcd

    echo "WiFi configured, waiting for connection..."
    sleep 10
  fi
fi
```

---

## Appendix E: Base Image Build (pi-gen)

### Directory Structure

```
pi-gen-musicbox/
├── config                    # pi-gen configuration
├── stage-musicbox/           # Custom stage
│   ├── 00-install-packages/
│   │   └── 00-packages       # Package list
│   ├── 01-configure-system/
│   │   ├── 00-run.sh         # System configuration
│   │   └── files/
│   │       ├── config.txt    # Boot config
│   │       ├── asound.conf   # ALSA config
│   │       └── ...
│   ├── 02-install-agent/
│   │   ├── 00-run.sh         # Install agent
│   │   └── files/
│   │       └── agent.tar.gz  # Pre-built agent
│   └── 03-install-services/
│       ├── 00-run.sh         # Install systemd units
│       └── files/
│           ├── musicbox-agent.service
│           ├── musicbox-agent.timer
│           └── musicbox-player.service
└── build.sh                  # Build script
```

### config
```bash
IMG_NAME="musicbox"
RELEASE="bookworm"
TARGET_HOSTNAME="musicbox"
KEYBOARD_KEYMAP="us"
KEYBOARD_LAYOUT="English (US)"
TIMEZONE_DEFAULT="America/New_York"
FIRST_USER_NAME="musicbox"
FIRST_USER_PASS=""
ENABLE_SSH=1
STAGE_LIST="stage0 stage1 stage2 stage-musicbox"
```

### stage-musicbox/00-install-packages/00-packages
```
nodejs
mpv
alsa-utils
i2c-tools
libgpiod2
gpiod
```

### stage-musicbox/01-configure-system/00-run.sh
```bash
#!/bin/bash -e

# Copy boot config
install -m 644 files/config.txt "${ROOTFS_DIR}/boot/config.txt"

# Copy ALSA config
install -m 644 files/asound.conf "${ROOTFS_DIR}/etc/asound.conf"

# Create musicbox user
on_chroot << EOF
useradd -r -s /bin/false -G audio,i2c,gpio musicbox
EOF

# Create directories
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox"
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox/agent"
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox/player"
install -d -m 755 "${ROOTFS_DIR}/var/cache/musicbox"
install -d -m 755 "${ROOTFS_DIR}/boot/musicbox"

# Set ownership
on_chroot << EOF
chown -R musicbox:musicbox /opt/musicbox
chown -R musicbox:musicbox /var/cache/musicbox
EOF

# Enable I2C
on_chroot << EOF
raspi-config nonint do_i2c 0
EOF
```

---

## Appendix F: Project Structure (Final)

```
musicbox/
├── docs/
│   └── device-management.md      # This document
│
├── server/                        # MusicBox Server
│   ├── src/
│   │   ├── routes/
│   │   │   ├── nfc.ts            # Existing NFC scan
│   │   │   ├── stream.ts         # Existing audio stream
│   │   │   ├── devices.ts        # NEW: Device management
│   │   │   ├── releases.ts       # NEW: Release management
│   │   │   └── config.ts         # NEW: System config
│   │   ├── db/
│   │   │   └── schema.ts         # Database schema
│   │   └── ...
│   ├── data/
│   │   ├── musicbox.db           # SQLite database
│   │   └── releases/             # Release tarballs
│   └── package.json
│
├── player/                        # MusicBox Player
│   ├── src/
│   │   └── ...                   # Existing player code
│   ├── package.json
│   └── tsconfig.json
│
├── agent/                         # NEW: Config Agent
│   ├── src/
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── register.ts
│   │   ├── state.ts
│   │   ├── packages.ts
│   │   ├── files.ts
│   │   ├── player.ts
│   │   ├── services.ts
│   │   ├── report.ts
│   │   └── system.ts
│   ├── package.json
│   └── tsconfig.json
│
├── image/                         # NEW: Base Image Build
│   ├── pi-gen-config/
│   │   ├── config
│   │   └── stage-musicbox/
│   ├── files/
│   │   ├── config.txt
│   │   ├── asound.conf
│   │   └── *.service
│   └── build.sh
│
└── shared/                        # Shared types
    └── src/
        └── types.ts
```
