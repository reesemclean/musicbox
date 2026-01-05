# MusicBox Player Deployment

The player can be deployed in multiple ways:

## 1. Docker (NixOS-based - Emulates Raspberry Pi)

### Build

```bash
# Build from project root (not player/ directory)
docker build -f player/Dockerfile -t musicbox-player .
```

### Run with local server

```bash
# Start server on host: npm run dev:server
docker run -d \
  --name musicbox-player \
  -p 8080:8080 \
  -v $(pwd)/test-config.json:/etc/musicbox/player.config.json:ro \
  musicbox-player
```

### Test

```bash
# Check status
curl http://localhost:8080/status

# Simulate card scan
curl -X POST http://localhost:8080/scan \
  -H "Content-Type: application/json" \
  -d '{"nfcId": "test-card-123"}'
```

## 2. NixOS (For Raspberry Pi)

### Add to your NixOS configuration

```nix
{
  inputs.musicbox.url = "github:yourusername/musicbox";

  outputs = { self, nixpkgs, musicbox }: {
    nixosConfigurations.raspberry-pi = nixpkgs.lib.nixosSystem {
      system = "aarch64-linux";
      modules = [
        musicbox.nixosModules.musicbox-player
        {
          services.musicbox-player = {
            enable = true;
            deviceId = 1;
            deviceName = "living-room";
            deviceSecret = "your-device-secret-uuid";
            serverUrl = "http://192.168.1.100:3000";
            httpPort = 8080;
          };
        }
      ];
    };
  };
}
```

This will:

- Install the player as a systemd service
- Auto-start on boot with automatic restarts
- Enable I2C for NFC reader
- Configure audio output
- Open firewall port
- Create musicbox user with proper permissions

### Build the package directly

```bash
nix build .#player
./result/bin/musicbox-player
```

## 3. Standalone Bundle (No Docker/Nix)

The player bundles into a single JavaScript file using esbuild.

### Build

```bash
cd player
npm install
npm run build:bundle
```

### Deploy

Copy these to your target machine:

- `dist/musicbox-player.js` - The bundled application
- `player.config.json` - Your device configuration

### Run

```bash
# Requires Node.js 22+ and ffmpeg installed on target
node dist/musicbox-player.js
```

Or make it executable:

```bash
chmod +x dist/musicbox-player.js
./dist/musicbox-player.js
```

## Configuration

All deployment methods use the same config file format:

```json
{
  "deviceId": 1,
  "deviceName": "living-room",
  "deviceSecret": "uuid-from-server",
  "serverUrl": "http://192.168.1.100:3000",
  "httpPort": 8080
}
```

### Config locations (checked in order):

1. `./player.config.json`
2. `/etc/musicbox/player.config.json`

### Environment variables (fallback):

- `DEVICE_NAME` - Device identifier
- `DEVICE_SECRET` - Authentication secret
- `SERVER_URL` - Server URL
- `TRIGGER_HTTP` - Enable HTTP API (default: true)
- `TRIGGER_NFC` - Enable NFC reader (default: false)
- `HTTP_PORT` - HTTP port (default: 8080)

## Dependencies

### Runtime

- **Node.js 22+** (or Docker/Nix handles this)
- **ffmpeg** - For audio playback (provides `ffplay`)

### For NFC reader (optional)

- I2C kernel module enabled
- User in `i2c` group
- PN532 NFC module connected via I2C

## Architecture

The player is built as:

1. **TypeScript source** → Compiled to ES modules
2. **esbuild** → Bundles into single `musicbox-player.js` (24KB)
3. **Deployment** → Docker/Nix/standalone

The bundle includes all application code but relies on Node.js runtime for:

- Built-in modules (http, child_process, readline, etc.)
- Native process spawning (for audio playback)
- OS integration

## Development

```bash
# Run directly from source (hot reload)
npm run dev

# Build bundle
npm run build:bundle

# Build with TypeScript compiler (emits dist/)
npm run build
```

## Comparison

| Method         | Size   | Setup  | Best For                         |
| -------------- | ------ | ------ | -------------------------------- |
| **Docker**     | ~150MB | Easy   | Local testing, cloud deployment  |
| **NixOS**      | ~50MB  | Medium | Raspberry Pi, declarative config |
| **Standalone** | ~24KB  | Manual | Quick deploys, custom setups     |

All methods produce the same running application - choose based on your infrastructure.
