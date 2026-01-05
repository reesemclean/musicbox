# MusicBox Project - Current State

**Date:** 2026-01-04

## Project Overview

MusicBox is an NFC-based music player system with two main components:
- **Server**: TanStack Start web app for managing music library, NFC cards, playlists, and devices
- **Player**: Node.js CLI app that runs on Raspberry Pi, scans NFC cards, streams audio from server

## Architecture

### Server (TanStack Start + Drizzle + SQLite)
- Web UI for managing music library (YouTube downloads), NFC cards, playlists, and devices
- REST API for player communication
- Streams audio to players via `/api/stream/:songId`
- Device management with heartbeat tracking

**Key Files:**
- `server/src/db/schema.ts` - Database schema (songs, cards, playlists, devices, etc.)
- `server/src/services/` - Business logic (devicesService, songsService, etc.)
- `server/src/routes/` - TanStack Start file-based routing
- `server/src/routes/api/` - API routes for player access (not ServerFns)

### Player (Node.js + TypeScript)

**Modular Architecture:**
```
PlayerCore (business logic)
├── AudioEngine (spawns ffplay/mpg123/afplay)
├── ServerClient (HTTP API calls)
└── Triggers (input sources)
    ├── KeyboardTrigger (readline for dev/testing)
    ├── HTTPTrigger (REST API for remote control)
    └── NFCReaderTrigger (stub for future NFC reader)
```

**Configuration:**
- Reads from `player.config.json` (preferred) or environment variables
- Config file format:
```json
{
  "deviceId": 1,
  "deviceName": "living-room",
  "deviceSecret": "uuid-here",
  "serverUrl": "http://192.168.1.100:3000",
  "httpPort": 8080
}
```

**Key Files:**
- `player/src/index.ts` - Main entry point, starts triggers
- `player/src/core/PlayerCore.ts` - Business logic (play, pause, next, etc.)
- `player/src/audio/AudioEngine.ts` - Spawns audio player child processes
- `player/src/triggers/` - Input triggers (keyboard, HTTP, NFC)
- `player/src/services/HeartbeatService.ts` - Sends status to server every 30s
- `player/src/config/PlayerConfig.ts` - Config loader

## What's Working

### Server
- ✅ Music library management (YouTube download with yt-dlp)
- ✅ NFC card registration and assignment (songs, playlists, actions)
- ✅ Playlist management
- ✅ Device management UI (`/devices` page)
- ✅ Device creation with config file download
- ✅ Heartbeat API endpoint (`/api/devices/heartbeat`)
- ✅ Audio streaming endpoint (`/api/stream/:songId`)
- ✅ NFC scan API (`/api/nfc/scan`)
- ✅ Remote control commands via HTTP proxy to player
- ✅ Dark mode support throughout UI

### Player
- ✅ Config file loading (JSON + env var fallback)
- ✅ Keyboard trigger for development (readline interface)
- ✅ HTTP trigger for remote control (Express-like server)
- ✅ Card scanning via server API
- ✅ Audio playback (streams from server, spawns ffplay/mpg123/afplay)
- ✅ Heartbeat service (sends IP + current song every 30s)
- ✅ Playlist playback with auto-advance
- ✅ Playback controls (play, pause, next, previous, stop)

### Device Registration Flow
1. Admin creates device in server UI (`/devices`)
2. Downloads `devicename.config.json` file
3. Deploys config to Pi at `./player.config.json` or `/etc/musicbox/player.config.json`
4. Player starts, reads config, sends heartbeat with IP address
5. Device shows as "online" in server UI
6. Admin can control player remotely via server UI (play, pause, next, etc.)

## Current Problem: Graceful Shutdown

**Issue:** Player does not exit cleanly when pressing Ctrl+C

**Symptoms:**
- Press Ctrl+C → "Shutting down..." message appears
- Process hangs and does not exit
- Must use `pkill -9 tsx` to force kill

**What blocks Node.js from exiting:**
1. Active child processes (ffplay/mpg123 audio player)
2. Open stdin (readline interface)
3. Active HTTP server with open connections
4. Active timers/intervals (heartbeat)
5. Pending promises (fetch calls)

**What we've tried:**
1. ✅ Added SIGINT/SIGTERM handlers
2. ✅ Call `stop()` on all triggers in shutdown handler
3. ✅ Kill audio process with SIGKILL
4. ✅ Close readline interface
5. ✅ Destroy all HTTP connections before closing server
6. ✅ Clear heartbeat interval
7. ✅ Call `process.stdin.destroy()`
8. ✅ Call `server.unref()` on HTTP server
9. ✅ Call `interval.unref()` on heartbeat
10. ✅ Synchronous shutdown (no async/await)
11. ✅ Immediate `process.exit(0)` after cleanup
12. ❌ Still hangs!

**Relevant Code:**

`player/src/index.ts` (lines 90-120):
```typescript
// Handle shutdown - be forceful
let isShuttingDown = false;
const shutdown = () => {
  if (isShuttingDown) {
    // Second Ctrl+C = immediate exit
    process.exit(0);
  }
  isShuttingDown = true;

  console.log("\n\n👋 Shutting down...");

  // Cleanup synchronously
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
```

`player/src/audio/AudioEngine.ts` (lines 89-99):
```typescript
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
}
```

`player/src/triggers/KeyboardTrigger.ts` (lines 65-79):
```typescript
async stop(): Promise<void> {
  if (this.isStopping) return;
  this.isStopping = true;

  if (this.rl) {
    this.rl.close();
    this.rl = undefined;
  }

  // Force stdin to close
  if (process.stdin.isTTY) {
    process.stdin.pause();
    process.stdin.destroy();
  }
}
```

`player/src/triggers/HTTPTrigger.ts` (lines 127-145):
```typescript
async stop(): Promise<void> {
  if (!this.server) {
    return;
  }

  // Forcefully destroy all active connections
  for (const conn of this.connections) {
    conn.destroy();
  }
  this.connections.clear();

  return new Promise((resolve) => {
    this.server!.close(() => {
      console.log("\n🌐 HTTP trigger stopped");
      this.server = undefined;
      resolve();
    });
  });
}
```

**Note:** HTTP server also has `this.server.unref()` called on line 114 after listen.

**Note:** Heartbeat interval has `this.interval.unref()` called on line 44 after setInterval.

## How to Run Locally

### Server
```bash
cd server
npm install
npm run dev
# Opens at http://localhost:3000
```

### Player (with device config)
```bash
cd player
npm install

# Create a device in server UI at http://localhost:3000/devices
# Download the config file and copy to player directory:
cp ~/Downloads/devicename.config.json ./player.config.json

# Start player
npm run dev
```

### Player (without device config - dev mode)
```bash
cd player
npm install
TRIGGER_HTTP=true npm run dev
# Uses env vars, no heartbeat
```

## Database Schema (Relevant Tables)

### devices
```sql
- id: integer (PK)
- name: text (unique) - e.g. "living-room"
- secret: text (unique) - UUID for authentication
- ipAddress: text - Set by heartbeat
- httpPort: integer - Default 8080
- status: text - 'inactive' | 'online' | 'offline'
- lastSeen: timestamp
- currentSong: text (JSON) - {title, artist, isPlaying}
- libraryVersion: integer
- createdAt: timestamp
```

### cards
```sql
- nfcId: text (PK) - NFC card ID
- contentType: text - 'song' | 'playlist' | 'action'
- contentPath: text - Path to song/playlist, or null for action
- action: text - 'play' | 'pause' | 'next' | 'previous' | 'stop'
- createdAt: timestamp
```

## API Endpoints

### Player → Server
- `POST /api/nfc/scan` - Scan NFC card, returns content mapping
- `POST /api/devices/heartbeat` - Send device status (IP, current song)
- `GET /api/stream/:songId` - Stream audio file

### Server → Player (HTTP Proxy)
- Server calls player's HTTP trigger endpoints:
  - `POST http://{ip}:{port}/scan` - Trigger card scan
  - `POST http://{ip}:{port}/play` - Play/resume
  - `POST http://{ip}:{port}/pause` - Pause
  - `POST http://{ip}:{port}/next` - Next track
  - `POST http://{ip}:{port}/previous` - Previous track
  - `POST http://{ip}:{port}/stop` - Stop
  - `GET http://{ip}:{port}/status` - Get player status

## Dependencies

### Server
- TanStack Start (React framework)
- Drizzle ORM + SQLite
- yt-dlp (YouTube download)
- music-metadata (audio metadata)

### Player
- tsx (TypeScript execution)
- Node.js built-ins: child_process, http, readline, os, fs

## Next Steps / TODO

1. **Fix graceful shutdown** - PRIMARY ISSUE
   - Player hangs on Ctrl+C
   - Need to identify what's keeping event loop alive
   - Consider debugging with `--trace-warnings` or `why-is-node-running` package

2. NFC reader implementation (after shutdown fixed)
3. NixOS deployment configuration
4. Error handling improvements
5. Logging improvements

## Important Notes

- **Config file vs env vars:** Config file is preferred for deployment (NixOS-friendly)
- **API routes vs ServerFns:** Player accesses server via API routes (not ServerFns). ServerFns are only for UI.
- **Audio player detection:** Player tries ffplay → mpg123 → afplay in order
- **Dark mode:** All server UI pages should support dark mode (recently fixed devices page)

## Kill Stuck Player Process

```bash
# Option 1: Kill by name
pkill -9 tsx

# Option 2: Find and kill by PID
ps aux | grep tsx
kill -9 <PID>

# Option 3: Kill all node
pkill -9 node
```

---

**For next conversation:** Focus on debugging why `process.exit(0)` is not exiting. Consider using `node --trace-warnings` or the `why-is-node-running` npm package to identify what's keeping the event loop alive.
