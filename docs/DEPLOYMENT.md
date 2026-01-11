# Deployment Guide

## Overview

MusicBox has two components:
- **Server**: TanStack Start web app (library management, device control)
- **Player**: Node.js app on Raspberry Pi (NFC scanning, audio playback)

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SERVER                                │
│  - Web UI (TanStack Start)                              │
│  - SQLite database                                       │
│  - Music library storage                                │
│  - Device management                                     │
│  Location: Home server / VPS / Local machine            │
└─────────────────────────────────────────────────────────┘
                           ↕ HTTP API
┌─────────────────────────────────────────────────────────┐
│                 PLAYERS (Raspberry Pi)                   │
│  - NFC card scanning                                     │
│  - Audio playback                                        │
│  - Heartbeat reporting                                   │
│  Location: Living room, bedroom, kitchen, etc.          │
└─────────────────────────────────────────────────────────┘
```

## Server Deployment

### Development

```bash
npm run dev:server
# Runs on http://localhost:3000
```

### Production (Docker)

**Create `server/Dockerfile`:**
```dockerfile
FROM node:22-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY server/package*.json ./server/
COPY shared/package*.json ./shared/
RUN npm ci --workspace=server

# Copy source
COPY server ./server
COPY shared ./shared

# Build
RUN npm run build --workspace=server

# Create data directory
RUN mkdir -p /app/server/data

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=server"]
```

**Build and run:**
```bash
docker build -t musicbox-server .
docker run -d \
  -p 3000:3000 \
  -v musicbox-data:/app/server/data \
  -v musicbox-library:/app/server/library \
  --name musicbox-server \
  musicbox-server
```

### Production (Node.js)

```bash
# Build
npm run build:server

# Run
cd server
NODE_ENV=production node .output/server/index.mjs
```

### Production (NixOS)

Create `server/nixos-module.nix`:
```nix
{ config, lib, pkgs, ... }:

{
  services.musicbox-server = {
    enable = true;
    port = 3000;
    dataDir = "/var/lib/musicbox";
  };
}
```

## Player Deployment

### Development

```bash
cd player
npm run dev
# Uses local server, keyboard triggers
```

### Production (Custom SD Card Image)

**Recommended approach** - see [docs/CUSTOM-IMAGE.md](docs/CUSTOM-IMAGE.md)

**Quick summary:**
```bash
# 1. Create device in server UI
# 2. Download config file
# 3. Build image
npm run build:image -- ./device-configs/living-room.config.json --wifi ./wifi.json --ssh ./ssh.json

# 4. Flash to SD card
sudo dd if=outputs/living-room.img of=/dev/diskX bs=4M status=progress

# 5. Boot Pi
# Service starts automatically via systemd
```

## Build Process

### Server Build

```bash
npm run build:server
# Output: server/.output/
```

Uses Vite to bundle:
- Server routes → `.output/server/`
- Static assets → `.output/public/`

### Player Build

```bash
cd player
npm run build:bundle
# Output: player/dist/musicbox-player.js
```

Creates single-file bundle with all dependencies embedded.

## Configuration

### Server Environment

**Development** (`.env.local`):
```env
DATABASE_URL=file:./data/musicbox.db
```

**Production**:
```env
DATABASE_URL=file:/var/lib/musicbox/musicbox.db
NODE_ENV=production
PORT=3000
```

### Player Configuration

**Config file** (`player.config.json`):
```json
{
  "deviceId": 1,
  "deviceName": "living-room",
  "deviceSecret": "uuid-from-server",
  "serverUrl": "http://192.168.1.100:3000",
  "httpPort": 8080
}
```

**Location** (checked in order):
1. `./player.config.json` (current directory)
2. `/etc/musicbox/player.config.json` (system-wide)
3. Environment variables (fallback)

## Network Requirements

### Ports

**Server:**
- `3000` - HTTP (web UI + API)

**Player:**
- `8080` - HTTP (remote control API)
- Outbound HTTP to server

### Firewall Rules

**Server (if remote):**
```bash
# Allow server access from local network
ufw allow 3000/tcp
```

**Player:**
```bash
# Built into NixOS config, automatically configured
# SSH: 22, Player HTTP: 8080
```

## Monitoring

### Server Health

```bash
# Check process
ps aux | grep node

# Check logs
journalctl -u musicbox-server -f

# Check database
sqlite3 server/data/musicbox.db ".tables"
```

### Player Health

```bash
# SSH to Pi
ssh root@PI_IP

# Check service
systemctl status musicbox-player

# View logs
journalctl -u musicbox-player -f

# Check heartbeat
curl http://localhost:8080/status
```

### Server UI Monitoring

- **Device page**: Shows all devices with status (online/offline)
- **Heartbeat**: Updates every 30 seconds
- **Current song**: Shows what's playing on each device

## Backup Strategy

### Server Data

**Database:**
```bash
# Backup
sqlite3 server/data/musicbox.db ".backup backup.db"

# Restore
cp backup.db server/data/musicbox.db
```

**Library:**
```bash
# Backup
tar -czf library-backup.tar.gz server/library/

# Restore
tar -xzf library-backup.tar.gz -C server/
```

### Player Configuration

```bash
# Backup device configs
cp -r device-configs/ device-configs-backup/

# Backup SD card image (recommended)
sudo dd if=/dev/diskX of=player-backup.img bs=4M status=progress
gzip player-backup.img
```

## Updates

### Server Updates

```bash
git pull
npm install
npm run build:server

# Restart service
docker restart musicbox-server
# or
systemctl restart musicbox-server
```

### Player Updates

**Method 1: Rebuild image** (clean)
```bash
cd player && npm run build:bundle
npm run build:image -- <config-file> --wifi <wifi-config> --ssh <ssh-config>
# Flash to new SD card
```

**Method 2: SSH update** (quick)
```bash
cd player && npm run build:bundle
scp dist/musicbox-player.js root@PI_IP:/tmp/
ssh root@PI_IP "cp /tmp/musicbox-player.js /nix/store/*/bin/musicbox-player && systemctl restart musicbox-player"
```

## Scaling

### Multiple Players

Each player:
- Gets unique device config from server
- Reports to same server
- Independent operation (works offline, queues when reconnected)

Build multiple images:
```bash
npm run build:image -- ./device-configs/living-room.json --wifi ./wifi.json --ssh ./ssh.json
npm run build:image -- ./device-configs/bedroom.json --wifi ./wifi.json --ssh ./ssh.json
npm run build:image -- ./device-configs/kitchen.json --wifi ./wifi.json --ssh ./ssh.json
```

### Multiple Servers

For distributed deployments:
- Each location has own server
- Players connect to local server
- Library sync via rsync/NFS (manual)

## Security

### Server

- **HTTPS**: Use reverse proxy (nginx/caddy)
- **Authentication**: Currently none - add if exposing publicly
- **Database**: File permissions (owner-only read/write)

### Player

- **SSH**: Key-based authentication only (no passwords)
- **Secrets**: Device secret stored in NixOS config (root-only readable)
- **Network**: Firewall limits open ports (22, 8080)
- **Updates**: Signed packages (Nix store immutability)

### Secrets Management

**Server:**
- Database contains device secrets
- No secrets in git

**Player:**
- Device secret baked into image
- WiFi password in NixOS config
- SSH private key on your machine (not in image)

## Troubleshooting

### Server Issues

**Port already in use:**
```bash
lsof -ti:3000 | xargs kill -9
```

**Database locked:**
```bash
# Check for stale locks
fuser server/data/musicbox.db
kill <PID>
```

**Out of disk space:**
```bash
# Clean old downloads
rm -rf server/library/downloads/*
```

### Player Issues

**Can't reach server:**
```bash
# Check network
ping 192.168.1.100

# Check DNS
nslookup your-server.com

# Check HTTP
curl http://your-server:3000/api/devices/heartbeat
```

**Audio not working:**
```bash
# List audio devices
aplay -l

# Test audio
speaker-test -t wav -c 2
```

**NFC not working:**
```bash
# Check I2C
i2cdetect -y 1

# Should show device at 0x24
```

See [docs/PI-SETUP.md](docs/PI-SETUP.md) for detailed troubleshooting.

## Development Workflow

### Local Development

```bash
# Terminal 1: Server
npm run dev:server

# Terminal 2: Player
npm run dev:player
```

### Testing Builds

**Server:**
```bash
npm run build:server
cd server && node .output/server/index.mjs
```

**Player:**
```bash
cd player
npm run build:bundle
node dist/musicbox-player.js
```

### Docker Testing

**Server:**
```bash
docker build -t musicbox-server .
docker run -p 3000:3000 musicbox-server
```

**Player:**
```bash
# Build image for testing
npm run build:image -- ./device-configs/test.config.json --wifi ./wifi.json --ssh ./ssh.json

# Flash to SD card and boot in Pi
```

## Architecture Notes

### Why Pre-Built Images?

**Pros:**
- Zero configuration on Pi
- Reproducible deployments
- Version control (configs in git)
- Fast deployment (5 min vs 30 min)

**Cons:**
- Requires Docker for building
- ~3.7GB image size
- Must rebuild for config changes

**Alternative**: Manual NixOS installation + SSH config deployment (see old docs)

### Why NixOS?

- **Declarative**: Configuration as code
- **Atomic**: Updates are all-or-nothing
- **Rollback**: Easy rollback to previous state
- **Reproducible**: Same config = same system

### Why Docker for Building?

- **macOS limitation**: Can't build NixOS natively
- **Cross-compilation**: Builds ARM images on x86/ARM
- **Isolation**: Doesn't require Nix on host system

## Resources

- [TanStack Start](https://tanstack.com/start) - Server framework
- [NixOS](https://nixos.org) - Linux distribution for Pi
- [Drizzle](https://orm.drizzle.team) - Database ORM
- [Docker](https://docker.com) - Containerization

## Next Steps

- [docs/CUSTOM-IMAGE.md](docs/CUSTOM-IMAGE.md) - Build Pi images
- [docs/PI-SETUP.md](docs/PI-SETUP.md) - Pi management and troubleshooting
