# MusicBox Player Deployment

Quick guide to deploying the MusicBox player to Raspberry Pi.

## Recommended: Generic Image Workflow

**Build once, use everywhere!**

### 1. Build Generic Image

```bash
cd player && npm run build:bundle && cd ..
git add player/dist && git commit -m "Build bundle" && git push

cd player/image-building

# Option A: No WiFi (setup wizard will prompt)
node --experimental-transform-types build-generic-image.ts

# Option B: WiFi pre-configured (connects automatically on boot)
node --experimental-transform-types build-generic-image.ts \
  --wifi-ssid "YourNetwork" \
  --wifi-password "YourPassword"
```

### 2. Flash & Setup

```bash
# Flash to SD card (reuse same image for all devices!)
sudo dd if=outputs/musicbox-generic.img of=/dev/rdiskX bs=4m

# Boot Pi, SSH in
ssh root@musicbox.local

# Run setup wizard
/root/setup-musicbox.sh
```

### 3. Update (No Reflashing!)

```bash
# On laptop
cd player && npm run build:bundle && cd ..
git add player/dist && git commit && git push

# On Pi
ssh root@musicbox-device.local
sudo nixos-rebuild switch
```

**See full guide:** [`docs/GENERIC-IMAGE-GUIDE.md`](docs/GENERIC-IMAGE-GUIDE.md)

---

## Alternative: Device-Specific Images

For advanced use cases where you want pre-configured images:

```bash
cd player/image-building
node --experimental-transform-types build-image.ts device-config.json
```

This builds a device-specific image with WiFi and device credentials embedded.

**See:** [`docs/CUSTOM-IMAGE.md`](docs/CUSTOM-IMAGE.md)

---

## Development Workflow

```bash
# Local development
nix develop .#player
cd player && npm run dev

# Test in Docker
npm run build:bundle
cd .. && ./scripts/test-docker.sh

# Deploy to Pi (after setup)
git add player/dist && git commit && git push
ssh root@musicbox-device.local "nixos-rebuild switch"
```

**See:** [`DEPLOYMENT.md`](DEPLOYMENT.md) for complete development guide

---

## Audio Troubleshooting

If MAX98357A audio isn't working:

```bash
# On Pi
bash /path/to/diagnose-audio.sh

# Or check manually
aplay -l  # Should show I2S card
speaker-test -t sine -f 1000
```

**See:** [`docs/MAX98357A-AUDIO-FIX.md`](docs/MAX98357A-AUDIO-FIX.md)

---

## Quick Reference

| Task | Command |
|------|---------|
| Build generic image (no WiFi) | `node build-generic-image.ts` |
| Build generic image (with WiFi) | `node build-generic-image.ts --wifi-ssid "..." --wifi-password "..."` |
| Flash SD card | `sudo dd if=image.img of=/dev/rdiskX bs=4m` |
| Setup device | `/root/setup-musicbox.sh` |
| Check status | `systemctl status musicbox-player` |
| View logs | `journalctl -u musicbox-player -f` |
| Update player | `nixos-rebuild switch` (after git push) |
| Diagnose audio | `bash diagnose-audio.sh` |

---

## Documentation

- **[Generic Image Guide](docs/GENERIC-IMAGE-GUIDE.md)** - Recommended workflow
- **[WiFi Embedding](docs/WIFI-EMBEDDING.md)** - Pre-configure WiFi in images
- **[Audio Troubleshooting](docs/MAX98357A-AUDIO-FIX.md)** - Fix audio issues
- **[Update Without Reflashing](docs/UPDATE-WITHOUT-REFLASHING.md)** - Git updates
- **[Custom Images](docs/CUSTOM-IMAGE.md)** - Device-specific images
- **[Development](DEPLOYMENT.md)** - Full development guide
- **[Quick Reference](docs/QUICK-REFERENCE.md)** - Command cheat sheet
