# MusicBox Deployment

Quick guide to deploying MusicBox to Raspberry Pi.

## Build Image

```bash
# Build the player bundle
cd packages/player && npm run build:bundle && cd ../..

# Build the Raspberry Pi image
cd packages/image
node --experimental-transform-types build-image.ts

# Or interactive mode for WiFi/SSH setup
node --experimental-transform-types build-image.ts --interactive
```

## Flash & Boot

```bash
# Flash to SD card
sudo dd if=../../outputs/musicbox-*.img of=/dev/rdiskX bs=4M status=progress
diskutil eject /dev/diskX

# Insert SD card in Pi and boot
# SSH in (if SSH was configured)
ssh pi@musicbox.local
```

## Quick Reference

| Task                | Command                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| Build image         | `cd packages/image && node --experimental-transform-types build-image.ts` |
| Flash SD card       | `sudo dd if=outputs/*.img of=/dev/rdiskX bs=4m`                           |
| Check player status | `systemctl status musicbox-player`                                        |
| View logs           | `journalctl -u musicbox-player -f`                                        |

## Documentation

- [Hardware Wiring](docs/HARDWARE-WIRING.md) - NFC reader and audio setup
- [Device Management](docs/device-management.md) - Managing devices from server
