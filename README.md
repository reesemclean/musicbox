# MusicBox 🎵

A physical music player system where NFC cards trigger instant playback across multiple Raspberry Pi devices.

## Project Structure

```
musicbox/
├── flake.nix              # Nix development environment
├── package.json           # Monorepo root
├── outputs/               # Built SD card images
│
└── packages/
    ├── server/            # Central library service (TanStack Start)
    │   ├── src/
    │   │   ├── routes/    # File-based routing
    │   │   ├── components/# React components
    │   │   ├── services/  # Business logic
    │   │   └── db/schema.ts # Database schema (Drizzle ORM)
    │   └── library/       # Music files and playlists
    │
    ├── player/            # Raspberry Pi player application
    │   ├── src/           # TypeScript source code
    │   ├── dist/          # Compiled player bundle
    │   └── e2e-testing/   # Docker-based testing
    │
    ├── image/             # Raspberry Pi image builder
    │   ├── build-image.ts # TypeScript build script
    │   └── pi-gen-config/ # Pi-gen configuration
    │
    ├── agent/             # Device management agent
    │
    └── shared/            # Shared TypeScript types
        └── src/types/
```

## Development Environment

**Prerequisites:** Docker (for building Raspberry Pi images)

### Quick Start

```bash
# Install dependencies
npm install

# Start server
npm run dev:server
# Opens http://localhost:3000

# Start player (development mode)
npm run dev:player
```

### Using Nix (Optional)

```bash
nix develop              # Full environment
nix develop .#server     # Server only
nix develop .#player     # Player only
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Database

```bash
cd server
npm run db:push      # Initialize SQLite database
```

### 3. Start Development

```bash
npm run dev:server   # Start server on http://localhost:3000
npm run dev:player   # Start player (separate terminal)
```

### 4. Deploy to Raspberry Pi

See [docs/CUSTOM-IMAGE.md](docs/CUSTOM-IMAGE.md) for creating bootable SD card images.

Quick overview:

```bash
# Build ready-to-flash SD card image
npm run build:image -- ./device-configs/my-device.json \
  --wifi ./device-configs/wifi.json \
  --ssh ./device-configs/ssh.json

# Flash to SD card
sudo dd if=./outputs/my-device.img of=/dev/diskX bs=4M status=progress
```

## Database Schema

See `server/src/db/schema.ts` for complete schema.

**Key Tables:**

- **devices**: Registered players with heartbeat tracking
- **cards**: NFC card to content mappings (songs/playlists/actions)
- **songs**: Music library metadata
- **playlists**: User-created playlists
- **downloadQueue**: YouTube download tracking

## Available Commands

**Root:**

```bash
npm run dev:server       # Start server
npm run dev:player       # Start player
npm run build            # Build all workspaces
npm run build:image      # Build Raspberry Pi SD card image
npm run lint             # Lint all workspaces
npm run typecheck        # Typecheck all workspaces
```

**Server:**

```bash
cd packages/server
npm run dev              # Development server (port 3000)
npm run build            # Production build
npm run db:push          # Apply database schema
npm run db:studio        # Open Drizzle Studio
```

**Player:**

```bash
cd packages/player
npm run dev              # Development mode with hot reload
npm run build            # Compile TypeScript
npm run build:bundle     # Create single-file bundle for Pi
```

## Tech Stack

**Server:** TanStack Start, SQLite, Drizzle ORM, Tailwind CSS, shadcn/ui, yt-dlp
**Player:** Node.js, TypeScript, ffplay/mpg123 (audio), PN532 (NFC)
**Infrastructure:** Nix, npm workspaces, Docker (for image building)
**Deployment:** NixOS on Raspberry Pi 4

## Architecture

**Server:**

- Web UI for managing library, devices, NFC cards
- REST API for player communication
- Streams audio to players via `/api/stream/:songId`
- Device registration and heartbeat tracking

**Player:**

- Modular trigger system (Keyboard, HTTP, NFC)
- Audio engine (spawns ffplay/mpg123)
- Heartbeat service (reports status every 30s)
- Config file: `player.config.json` or env variables

**Deployment:**

- Pre-configured NixOS images with WiFi, SSH, device credentials
- Flash to SD card, boot Pi, automatic service startup
- Remote control via server UI

## Documentation

- [CUSTOM-IMAGE.md](docs/CUSTOM-IMAGE.md) - Build bootable Raspberry Pi images
- [PI-SETUP.md](docs/PI-SETUP.md) - Raspberry Pi setup and troubleshooting
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deployment architecture and workflows

## Testing NFC Card Registration

1. Start server: `npm run dev:server`
2. Open http://localhost:3000/cards
3. Click "Register New Card"
4. Simulate scan: `cd player && npm run simulate-nfc`
5. Assign content and save

## Troubleshooting

**Database issues:**

```bash
rm server/data/musicbox.db && cd server && npm run db:push
```

**Port conflict:**
Edit `server/package.json` dev script to use different port.

**Docker not running (for image builds):**
Start Docker Desktop before running `npm run build:image`.

---

**Resources:** [TanStack Start](https://tanstack.com/start) • [Drizzle ORM](https://orm.drizzle.team/) • [Nix](https://nixos.org)
