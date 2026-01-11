# MusicBox Player - Quick Reference

## 🔧 Development (Your Laptop)

```bash
# Start dev server
cd player && npm run dev

# Build bundle
npm run build:bundle

# Test in Docker
cd .. && ./scripts/test-docker.sh

# Commit and push
git add player/src player/dist
git commit -m "Description"
git push origin main
```

---

## 🔨 Build SD Card Image (One Time)

```bash
# Set your GitHub repo
export GIT_REPO="reesemclean/musicbox"

# Build image
cd player/image-building
node --experimental-transform-types build-image.ts ../../device-config.json

# Flash to SD card
sudo dd if=outputs/device-name.img of=/dev/rdiskX bs=4m status=progress
diskutil eject /dev/diskX
```

---

## 🚀 Update Player (No Reflashing!)

```bash
# 1. On laptop: Make changes and push
cd player && npm run build:bundle && cd ..
git add player/src player/dist
git commit -m "Fix bug" && git push

# 2. On Pi: Update
ssh root@musicbox-device-name.local
nixos-rebuild switch
```

---

## 🔄 Rollback

```bash
# On Pi: Revert to previous version
nixos-rebuild switch --rollback

# Or use update script
sudo update-player.sh --rollback
```

---

## 📊 Monitor Player

```bash
# Check status
sudo systemctl status musicbox-player

# Live logs
sudo journalctl -u musicbox-player -f

# Recent logs
sudo journalctl -u musicbox-player -n 50

# Restart service
sudo systemctl restart musicbox-player
```

---

## 🔍 Diagnose Audio

```bash
# Run diagnostics
bash /path/to/diagnose-audio.sh

# Check audio card
aplay -l

# Test speaker
speaker-test -t sine -f 1000

# Check GPIO
gpioget gpiochip0 22

# Check I2S overlay
dtoverlay -l | grep i2s
```

---

## 🌐 Network

```bash
# Connect via .local hostname
ssh root@musicbox-device-name.local

# Find IP address (on Pi)
ip addr show wlan0

# Change WiFi (on Pi)
sudo nano /etc/nixos/secrets.nix
sudo nixos-rebuild switch
```

---

## 📝 Configuration Files

| File | Purpose | Location |
|------|---------|----------|
| `configuration.nix` | Main NixOS config | `/etc/nixos/` (on Pi) |
| `secrets.nix` | WiFi, device secret, SSH key | `/etc/nixos/` (on Pi) |
| `nixos-module.nix` | Player service definition | Git repo (fetched automatically) |
| `package.nix` | Player package build | Git repo (fetched automatically) |
| `dist/musicbox-player.js` | Built player bundle | Git repo (must commit!) |

---

## 🛠️ Common Tasks

### Change Server URL
```bash
# On Pi
sudo nano /etc/nixos/secrets.nix
# Update server.url
sudo nixos-rebuild switch
```

### Change Device Name
```bash
# On Pi
sudo nano /etc/nixos/configuration.nix
# Update networking.hostName
sudo nixos-rebuild switch
sudo reboot
```

### Update NixOS Module
```bash
# On laptop
vim player/image-building/nixos-module.nix
git add player/image-building/nixos-module.nix
git commit -m "Update module" && git push

# On Pi
sudo nixos-rebuild switch
```

### Test Changes Before Committing
```bash
# Create test branch
git checkout -b test-feature
npm run build:bundle
git add -A && git commit -m "Test feature"
git push origin test-feature

# On Pi: Switch to test branch
sudo nano /etc/nixos/configuration.nix
# Change: ref = "test-feature";
sudo nixos-rebuild switch

# If works: Merge to main
git checkout main && git merge test-feature
git push origin main

# On Pi: Switch back
sudo nano /etc/nixos/configuration.nix
# Change: ref = "main";
sudo nixos-rebuild switch
```

---

## 🐛 Troubleshooting

### Service won't start after update
```bash
# Check logs
sudo journalctl -u musicbox-player -n 100

# Rollback
sudo nixos-rebuild switch --rollback

# Check what changed
nixos-rebuild list-generations
```

### Git fetch fails
```bash
# Check network
ping github.com

# Check config
sudo cat /etc/nixos/configuration.nix | grep fetchGit

# For private repos: Set up SSH key
ssh-keygen -t ed25519 -f /root/.ssh/id_musicbox
# Add to GitHub deploy keys
```

### Audio not working
```bash
# Check I2S card
aplay -l

# Check service has audio tools
which ffplay pactl amixer

# Reboot (device tree changes)
sudo reboot

# See full guide
cat /path/to/MAX98357A-AUDIO-FIX.md
```

### Hash mismatch error
```bash
# Clear Nix cache
sudo nix-store --delete /nix/store/*-source
sudo nixos-rebuild switch

# Or pin to commit
sudo nano /etc/nixos/configuration.nix
# Add: rev = "commit-hash";
```

---

## 📚 Full Documentation

- **Audio Issues:** `docs/MAX98357A-AUDIO-FIX.md`
- **Quick Audio Fix:** `docs/QUICK-AUDIO-FIX.md`
- **Update Guide:** `docs/UPDATE-WITHOUT-REFLASHING.md`
- **Deployment:** `DEPLOYMENT.md`
- **Pi Setup:** `docs/PI-SETUP.md`
- **Custom Images:** `docs/CUSTOM-IMAGE.md`

---

## 🎯 Typical Workflow

### Day-to-day Development
```bash
# 1. Make changes
vim player/src/core/PlayerCore.ts

# 2. Test locally
cd player && npm run dev

# 3. Build and push
npm run build:bundle
cd ..
git add player/src player/dist
git commit -m "Improve playback"
git push

# 4. Update Pi
ssh root@musicbox-device.local "nixos-rebuild switch"

# 5. Monitor
ssh root@musicbox-device.local "journalctl -u musicbox-player -f"
```

### Weekly Maintenance
```bash
# On Pi
# Check disk space
df -h

# Clean old Nix generations (keep last 5)
sudo nix-collect-garbage --delete-older-than 30d

# Update system packages (if needed)
sudo nix-channel --update
sudo nixos-rebuild switch
```

---

## 💡 Pro Tips

- Always commit `dist/` after building bundle
- Test changes with `npm run dev` before pushing
- Use descriptive commit messages
- Check logs after every update
- Keep at least 2-3 old generations for rollback
- Pin to specific commit for production stability
- Use test branches for experimental features
- Set up automatic updates for hands-off operation

---

**Remember:** You only flash the SD card ONCE. All updates are done via Git + `nixos-rebuild switch`! 🚀
