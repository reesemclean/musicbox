# MusicBox Image Builder

Build a custom Raspberry Pi OS image with MusicBox pre-installed.

## Quick Start (Recommended)

The easiest way to build a MusicBox image is using the interactive builder script with Docker. This works on **macOS, Windows, and Linux**.

### Prerequisites

- **Docker Desktop** - [Download here](https://www.docker.com/products/docker-desktop)
- **Node.js 22+** - [Download here](https://nodejs.org/)

### Build an Image

```bash
cd image
npm install
npm run build
```

If `build-config.json` exists, it will be used automatically. Otherwise, you'll be prompted for settings:

| Setting        | Description                          | Default                      |
| -------------- | ------------------------------------ | ---------------------------- |
| **Server URL** | MusicBox server address              | `http://musicbox.local:3000` |
| **SSH Key**    | Select from your `~/.ssh/*.pub` keys | (optional)                   |
| **Timezone**   | System timezone                      | Your system timezone         |
| **WiFi**       | Network name, password, country      | (optional)                   |

The build takes **30-60 minutes** and outputs to:

```
outputs/musicbox.img
```

### Using a Config File

For automated/repeated builds, create a config file:

```bash
cp build-config.example.json build-config.json
# Edit build-config.json with your settings
npm run build
```

To force interactive mode even when a config file exists:

```bash
npm run build:interactive
```

**build-config.json format:**

```json
{
  "serverUrl": "https://musicbox.example.com",
  "sshKeyFile": "~/.ssh/id_ed25519.pub",
  "timezone": "America/New_York",
  "wifi": {
    "ssid": "YourNetworkName",
    "password": "YourPassword",
    "country": "US"
  }
}
```

## Flashing to SD Card

### 1. Find Your SD Card Device

Insert your SD card and identify the device:

**macOS:**

```bash
diskutil list
# Look for your SD card, e.g., /dev/disk2
```

**Linux:**

```bash
lsblk
# Look for your SD card, e.g., /dev/sdb
```

⚠️ **WARNING:** Double-check the device name! Using the wrong device will destroy data.

### 2. Unmount the SD Card

**macOS:**

```bash
diskutil unmountDisk /dev/diskN
# Replace diskN with your device (e.g., disk2)
```

**Linux:**

```bash
sudo umount /dev/sdX*
# Replace sdX with your device (e.g., sdb)
```

### 3. Flash the Image

**macOS:**

```bash
sudo dd if=outputs/musicbox.img of=/dev/rdiskN bs=4m
# Use rdiskN (not diskN) for faster writes
```

**Linux:**

```bash
sudo dd if=outputs/musicbox.img of=/dev/sdX bs=4M status=progress conv=fsync
```

### 4. Sync and Eject

```bash
sync

# macOS
diskutil eject /dev/diskN

# Linux
sudo eject /dev/sdX
```

## WiFi Configuration

### Option 1: During Build (Recommended)

When running `./build-image.sh`, enter your WiFi credentials when prompted. They will be embedded directly in the image.

### Option 2: After Flashing (Boot Partition)

If you didn't configure WiFi during build, or need to change networks:

1. After flashing, mount the boot partition
2. Create a file at `musicbox/wifi.txt`:

**macOS:**

```bash
# The boot partition mounts automatically after flashing
cat > /Volumes/bootfs/musicbox/wifi.txt << EOF
SSID="YourNetworkName"
PASSWORD="YourPassword"
COUNTRY="US"
EOF
```

**Linux:**

```bash
# Mount the boot partition first
sudo mkdir -p /mnt/boot
sudo mount /dev/sdX1 /mnt/boot

cat > /mnt/boot/musicbox/wifi.txt << EOF
SSID="YourNetworkName"
PASSWORD="YourPassword"
COUNTRY="US"
EOF

sudo umount /mnt/boot
```

**Country Codes:** US, GB, DE, FR, CA, AU, JP, etc.

### Option 3: Ethernet

Just plug in Ethernet - it will get an IP via DHCP automatically.

## First Boot

1. Insert the SD card into your Raspberry Pi
2. Power on - the first boot takes 1-2 minutes
3. The device will:
   - Configure WiFi (if credentials were provided)
   - Connect to your MusicBox server
   - Appear in the server UI as "Pending"

## Device Registration

1. Open your MusicBox server UI
2. Go to **Devices** → **Pending Devices**
3. Click **Approve** and give it a name (e.g., "Living Room")
4. The device hostname updates to `musicbox-living-room.local`
5. SSH access: `ssh musicbox@musicbox-living-room.local`

## Troubleshooting

### Check Bootstrap Logs

```bash
ssh musicbox@musicbox.local
journalctl -u musicbox-bootstrap -f
```

### Check Player Logs

```bash
journalctl -u musicbox-player -f
```

### Verify Hardware

```bash
# Check I2C (NFC reader)
i2cdetect -y 1

# Check audio devices
aplay -l

# Check GPIO
gpioinfo
```

---

## Hardware Wiring Reference

```
Raspberry Pi GPIO Header
┌─────────────────────────────────┐
│ 3V3  (1) (2)  5V                │
│ SDA  (3) (4)  5V     ←── NFC VCC│
│ SCL  (5) (6)  GND    ←── NFC GND│
│      (7) (8)  TX                │
│ GND  (9) (10) RX                │
│     (11) (12) GPIO18 ←── I2S BCLK (DAC)
│     (13) (14) GND                │
│     (15) (16)                    │
│ 3V3 (17) (18)                    │
│     (19) (20) GND                │
│     (21) (22)                    │
│     (23) (24)                    │
│ GND (25) (26)                    │
│     (27) (28)                    │
│     (29) (30) GND                │
│     (31) (32)                    │
│     (33) (34) GND                │
│ I2S LRCLK (35) (36)              │  ←── GPIO19
│     (37) (38)                    │
│ GND (39) (40) GPIO21 ←── I2S DIN │  (DAC)
└─────────────────────────────────┘

NFC Reader (PN532) - I2C Mode:
  - VCC → Pin 4 (5V)
  - GND → Pin 6
  - SDA → Pin 3 (GPIO2)
  - SCL → Pin 5 (GPIO3)

Audio DAC (MAX98357A):
  - VIN → 5V
  - GND → GND
  - BCLK → Pin 12 (GPIO18)
  - LRCLK → Pin 35 (GPIO19)
  - DIN → Pin 40 (GPIO21)
```
