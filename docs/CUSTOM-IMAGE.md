# Building Raspberry Pi Images

Build ready-to-flash SD card images with MusicBox Player, WiFi, and SSH pre-configured.

## Prerequisites

- **Docker** (required for building on macOS/non-Linux)
- **10GB free disk space**
- Device config from server UI (`/devices` page)

## Quick Start

### 1. Create Device in Server

```bash
# Start server
npm run dev:server

# Open http://localhost:3000/devices
# Click "Create Device"
# Download config file (e.g., living-room.config.json)
```

### 2. Create WiFi Config

Create `wifi-config.json`:

```json
{
  "ssid": "YourWiFiName",
  "password": "YourWiFiPassword"
}
```

### 3. Create SSH Config

Create `ssh-config.json`:

```json
{
  "publicKey": "ssh-ed25519 AAAAC3... your-email@example.com"
}
```

Or use a key file:

```json
{
  "keyFile": "~/.ssh/id_ed25519.pub"
}
```

### 4. Build Image

```bash
# From project root
npm run build:image -- \
  ./device-configs/living-room.config.json \
  --wifi ./device-configs/wifi-config.json \
  --ssh ./device-configs/ssh-config.json
```

Build takes **20-40 minutes** first time, ~5 minutes after (Docker layer caching).

Output: `outputs/living-room.img` (~3.7GB)

### 5. Flash to SD Card

**macOS:**

```bash
# Find SD card
diskutil list

# Unmount
diskutil unmountDisk /dev/disk4

# Flash (replace disk4 with your SD card)
sudo dd if=outputs/living-room.img of=/dev/disk4 bs=4M status=progress

# Eject
diskutil eject /dev/disk4
```

**Linux:**

```bash
lsblk                                    # Find SD card
sudo umount /dev/sdX                     # Unmount
sudo dd if=outputs/living-room.img of=/dev/sdX bs=4M status=progress
sudo eject /dev/sdX
```

### 6. Boot Pi

1. Insert SD card
2. Power on Raspberry Pi
3. Wait 2-3 minutes for first boot
4. Pi connects to WiFi automatically
5. Player service starts automatically
6. Device shows "online" in server UI

## Configuration Details

### What Gets Baked In

- ✅ MusicBox Player (systemd service)
- ✅ WiFi credentials
- ✅ Device ID, name, and secret
- ✅ Server URL
- ✅ SSH access (root user, key-based auth)
- ✅ Firewall (SSH port 22, Player HTTP port 8080)
- ✅ I2C and audio hardware support

### Generated NixOS Configuration

The build script generates:

- `configuration.nix` - System config (hostname, networking, services)
- `secrets.nix` - WiFi password, device secret, SSH key
- Copies `image-building/nixos-module.nix` - Player service definition
- Copies `package.nix` - Player package
- Copies `dist/` - Compiled player bundle

## Interactive Mode

Run without config files to be prompted:

```bash
npm run build:image -- ./device-configs/living-room.config.json
# Will prompt for WiFi SSID, password, and SSH key selection
```

## SSH Access

After booting:

```bash
# Find Pi IP address
nmap -sn 192.168.1.0/24 | grep musicbox
# or check your router's DHCP leases

# SSH as root (password-less with your key)
ssh root@192.168.1.31

# Check player status
systemctl status musicbox-player

# View logs
journalctl -u musicbox-player -f
```

## Multiple Devices

```bash
# Build multiple images
npm run build:image -- ./device-configs/living-room.config.json --wifi ./wifi.json --ssh ./ssh.json
npm run build:image -- ./device-configs/bedroom.config.json --wifi ./wifi.json --ssh ./ssh.json
npm run build:image -- ./device-configs/kitchen.config.json --wifi ./wifi.json --ssh ./ssh.json

# Outputs:
# outputs/living-room.img
# outputs/bedroom.img
# outputs/kitchen.img
```

## Updating Player Code

To deploy updated player code:

### Option A: Rebuild Image (Clean)

```bash
cd player
npm run build:bundle    # Compile new code
cd ..
npm run build:image -- ./device-configs/device.config.json --wifi ./wifi.json --ssh ./ssh.json
# Flash new image to SD card
```

### Option B: Update Over SSH (Fast)

```bash
# Copy new bundle to Pi
scp player/dist/musicbox-player.js root@PI_IP:/tmp/

# SSH in and replace
ssh root@PI_IP
cp /tmp/musicbox-player.js /nix/store/*/bin/musicbox-player
systemctl restart musicbox-player
```

## Troubleshooting

**Build fails:**

- Ensure Docker is running: `docker info`
- Clear cache: `docker system prune -a`
- Check player bundle exists: `ls player/dist/musicbox-player.js`

**Pi doesn't boot:**

- Verify SD card flashed correctly
- Try different SD card
- Check power supply (needs 3A for Pi 4)

**Pi doesn't connect to WiFi:**

- SSH via Ethernet cable
- Check logs: `journalctl -u wpa_supplicant`
- Verify WiFi credentials in build config

**Can't SSH:**

- Verify Pi is on network: `ping PI_IP`
- Check SSH key matches what you provided
- Port 22 might be blocked by router firewall

**Player not running:**

```bash
ssh root@PI_IP
systemctl status musicbox-player
journalctl -u musicbox-player -n 50
```

Common issues:

- Wrong device secret → Check server UI
- Can't reach server → Check server URL, firewall
- Audio device not found → Check `aplay -l`

## Architecture Notes

**Why Docker?**

- macOS cannot build NixOS images natively (requires Linux kernel)
- Docker provides Linux environment with Nix tools
- Uses `linux/aarch64` platform for ARM cross-compilation

**Build Process:**

1. TypeScript script generates NixOS config files
2. Builds Docker image with Nix and nixos-generators
3. Runs `nixos-generate -f sd-aarch64` inside container
4. Extracts `.img` file from Nix store
5. Outputs to `outputs/` directory

**Image Size:**

- Compressed: ~1.5GB
- Uncompressed: ~3.7GB
- Flash time: 3-5 minutes

## File Organization

```
musicbox/
├── device-configs/        # Device and config files
│   ├── living-room.config.json
│   ├── wifi-config.json
│   └── ssh-config.json
├── outputs/               # Built images (gitignored)
│   └── living-room.img
└── player/
    └── image-building/
        ├── build-image.ts         # Build script
        ├── Dockerfile.builder     # Docker environment
        ├── build-image.ts         # Build script
        ├── Dockerfile.builder     # Docker environment
        └── nixos-module.nix       # Player service config
```

## Security Notes

- SSH: Root login allowed, but **only via SSH key** (no password)
- Firewall: Only ports 22 (SSH) and 8080 (player HTTP) open
- Secrets: Device secret stored in `/nix/store` (immutable)
- WiFi password: Stored in plaintext in NixOS config (filesystem encryption recommended for production)

## Next Steps

- [PI-SETUP.md](PI-SETUP.md) - Pi troubleshooting and management
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment workflows and architecture
