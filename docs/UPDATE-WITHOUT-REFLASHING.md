# Update Player Without Reflashing SD Card

This guide shows you how to update your MusicBox player on the Raspberry Pi **without reflashing the SD card**.

---

## Overview

With the Git-based configuration, you can:
- ✅ Make code changes on your laptop
- ✅ Push to GitHub
- ✅ SSH to Pi and run one command to update
- ✅ Instant rollback if something breaks
- ✅ **No reflashing required!**

---

## One-Time Setup

### 1. Set Your Git Repository

Before building your first image, set the `GIT_REPO` environment variable:

```bash
# Set your GitHub username/repo
export GIT_REPO="yourusername/musicbox"

# Or add to your shell profile (~/.zshrc or ~/.bashrc)
echo 'export GIT_REPO="yourusername/musicbox"' >> ~/.zshrc
```

### 2. Build Initial Image

```bash
# Build player bundle
cd player
npm run build:bundle
cd ..

# Commit dist to git (important!)
git add player/dist
git commit -m "Add built player bundle"
git push origin main

# Build SD card image
cd player/image-building
node --experimental-transform-types build-image.ts ../../device-config.json
```

### 3. Flash Once

```bash
# Flash the image to SD card (only needed once!)
sudo dd if=outputs/device-name.img of=/dev/diskX bs=4m status=progress
```

**This is the LAST time you need to flash the SD card!** 🎉

---

## Update Workflow (No Reflashing)

### Quick Version

```bash
# 1. On your laptop: Make changes and push
cd player && npm run build:bundle && cd ..
git add player/src player/dist
git commit -m "Fix audio bug"
git push origin main

# 2. On Pi: Update
ssh root@musicbox-device-name.local
nixos-rebuild switch
```

**That's it!** The player is updated.

---

### Detailed Version

#### Step 1: Make Changes (Your Laptop)

```bash
# Edit your player code
vim player/src/audio/AudioEngine.ts

# Test locally
cd player
npm run dev
# Verify changes work

# Build the bundle
npm run build:bundle

# Verify bundle was created
ls -lh dist/musicbox-player.js
```

#### Step 2: Commit and Push

```bash
# Commit source AND built bundle
git add player/src player/dist
git commit -m "Improve audio handling"
git push origin main
```

**Critical:** You MUST commit the `dist/` directory! The Pi fetches the pre-built bundle from Git.

#### Step 3: SSH to Your Pi

```bash
# Connect via .local hostname (requires Avahi/mDNS)
ssh root@musicbox-device-name.local

# Or by IP address
ssh root@192.168.1.123
```

#### Step 4: Update the Player

```bash
# On the Pi: Rebuild with latest code
nixos-rebuild switch
```

**What happens:**
1. NixOS fetches latest code from your Git repo
2. Builds new player package with updated `dist/musicbox-player.js`
3. Updates system configuration
4. Restarts `musicbox-player` service automatically
5. Keeps old version for instant rollback

#### Step 5: Verify

```bash
# Check service status
systemctl status musicbox-player

# Watch logs
journalctl -u musicbox-player -f

# Test with an NFC card!
```

---

## Using the Update Script (Optional)

For easier updates, you can use the provided script:

### Copy Script to Pi (One Time)

```bash
# On your laptop:
scp player/scripts/update-player.sh root@musicbox-device-name.local:/usr/local/bin/

# On Pi:
chmod +x /usr/local/bin/update-player.sh
```

### Update with Script

```bash
# On Pi:
sudo update-player.sh
```

The script:
- ✅ Shows current version
- ✅ Confirms before updating
- ✅ Rebuilds system
- ✅ Checks service started correctly
- ✅ Shows recent logs

### Rollback with Script

If something breaks:

```bash
# On Pi:
sudo update-player.sh --rollback
```

Instantly reverts to previous working version!

---

## What Gets Updated

When you run `nixos-rebuild switch`, NixOS updates:

| Component | How It Updates |
|-----------|----------------|
| **Player code** | Fetches from Git, rebuilds package |
| **nixos-module.nix** | Fetches from Git, reconfigures system |
| **package.nix** | Fetches from Git, rebuilds player |
| **dist/ bundle** | Fetches from Git (must be committed!) |
| **System packages** | Updates if declared in module |
| **Configuration** | Re-applies all settings |

**What does NOT change:**
- ❌ WiFi credentials (in `/etc/nixos/secrets.nix`)
- ❌ Device ID/secret (in `/etc/nixos/secrets.nix`)
- ❌ SSH keys
- ❌ Base NixOS system (unless you changed `configuration.nix`)

---

## Updating Other Configuration

### Change WiFi Network

```bash
# On Pi:
sudo nano /etc/nixos/secrets.nix

# Update:
wifi = {
  ssid = "NewNetwork";
  password = "NewPassword";
};

# Apply changes:
sudo nixos-rebuild switch
```

### Change Server URL

```bash
# On Pi:
sudo nano /etc/nixos/secrets.nix

# Update:
server = {
  url = "http://new-server-ip:3000";
};

# Apply:
sudo nixos-rebuild switch
```

### Change Device Name

```bash
# On Pi:
sudo nano /etc/nixos/configuration.nix

# Find and update:
networking.hostName = "musicbox-new-name";

# Apply:
sudo nixos-rebuild switch
sudo reboot  # Needed for hostname change
```

---

## Rollback

NixOS keeps ALL previous system generations. You can always rollback!

### Manual Rollback

```bash
# List all generations
nixos-rebuild list-generations

# Roll back to previous
nixos-rebuild switch --rollback

# Or roll back to specific generation
nixos-rebuild switch --switch-generation 42
```

### Automatic Rollback on Boot

If the Pi fails to boot after an update, **NixOS bootloader menu** lets you select a previous working generation. Hold Shift during boot to see the menu.

---

## Troubleshooting

### Update fails: "error: cannot download"

**Cause:** Git repo not accessible (private repo or wrong URL)

**Fix:**
```bash
# On Pi, check configuration:
sudo cat /etc/nixos/configuration.nix | grep fetchGit

# Should see your repo URL
# If wrong, you need to edit it:
sudo nano /etc/nixos/configuration.nix
# Update the url = "..." line
```

If your repo is **private**, you need to set up authentication:
```bash
# Generate SSH key on Pi
ssh-keygen -t ed25519 -f /root/.ssh/id_musicbox

# Add to GitHub as deploy key
cat /root/.ssh/id_musicbox.pub
# Copy and add to: github.com/youruser/musicbox/settings/keys

# Update configuration to use SSH
sudo nano /etc/nixos/configuration.nix
# Change: url = "git@github.com:youruser/musicbox.git";
```

### Update succeeds but service won't start

**Check logs:**
```bash
sudo journalctl -u musicbox-player -n 50
```

**Common issues:**
- Missing file in `dist/` - rebuild bundle and commit
- Syntax error in code - check build logs
- Permissions changed - check user/groups

**Quick fix:** Rollback and investigate
```bash
sudo nixos-rebuild switch --rollback
```

### "error: hash mismatch" when updating

**Cause:** NixOS cached an old version of your repo

**Fix:**
```bash
# Clear Nix cache for your repo
sudo nix-store --delete /nix/store/*-source

# Try update again
sudo nixos-rebuild switch
```

Or add a commit hash to configuration (more reliable):
```bash
sudo nano /etc/nixos/configuration.nix

# Find fetchGit and add rev:
musicbox = builtins.fetchGit {
  url = "https://github.com/youruser/musicbox";
  ref = "main";
  rev = "abc123...";  # Get from: git rev-parse HEAD
};
```

### Want to test changes before committing

**Option 1:** Use a branch
```bash
# On laptop: Create test branch
git checkout -b test-audio-fix
npm run build:bundle
git add -A && git commit -m "Test audio fix"
git push origin test-audio-fix

# On Pi: Update configuration to use branch
sudo nano /etc/nixos/configuration.nix
# Change: ref = "test-audio-fix";
sudo nixos-rebuild switch

# If it works, merge to main
git checkout main && git merge test-audio-fix
git push origin main

# On Pi: Switch back to main
sudo nano /etc/nixos/configuration.nix
# Change: ref = "main";
sudo nixos-rebuild switch
```

**Option 2:** Pin to specific commit
```bash
# Get commit hash
git rev-parse HEAD

# On Pi:
sudo nano /etc/nixos/configuration.nix
# Add: rev = "commit-hash-here";
sudo nixos-rebuild switch
```

---

## Advanced: Automatic Updates

Want the Pi to auto-update every night?

### Create Update Service

```bash
# On Pi: Create update script
cat > /usr/local/bin/auto-update.sh <<'EOF'
#!/bin/bash
set -e

# Log to journald
exec 1> >(logger -t musicbox-auto-update -p info)
exec 2> >(logger -t musicbox-auto-update -p error)

echo "Starting automatic update..."

# Run update
if nixos-rebuild switch; then
  echo "Update successful"
else
  echo "Update failed - system unchanged"
  exit 1
fi
EOF

chmod +x /usr/local/bin/auto-update.sh
```

### Create Systemd Timer

Add to your `configuration.nix`:

```nix
# Auto-update service
systemd.services.musicbox-auto-update = {
  description = "MusicBox automatic update";
  serviceConfig = {
    Type = "oneshot";
    ExecStart = "/usr/local/bin/auto-update.sh";
  };
};

# Run daily at 3am
systemd.timers.musicbox-auto-update = {
  description = "MusicBox automatic update timer";
  wantedBy = [ "timers.target" ];
  timerConfig = {
    OnCalendar = "daily";
    OnClockChange = "3:00";
    Persistent = true;
  };
};
```

Then apply:
```bash
sudo nixos-rebuild switch
```

Check timer:
```bash
systemctl list-timers musicbox-auto-update
```

---

## Comparison: Reflash vs Update

| Aspect | Reflash SD Card | `nixos-rebuild switch` |
|--------|-----------------|------------------------|
| **Time** | 30-40 min build + 10 min flash | 2-5 min |
| **Downtime** | Full shutdown, remove SD | ~10 seconds (service restart) |
| **Risk** | If something wrong, Pi won't boot | Old version kept, instant rollback |
| **WiFi/Secrets** | Must reconfigure | Preserved |
| **When to use** | First setup, major OS changes | Code updates, config tweaks |

---

## Best Practices

### 1. Always Commit `dist/`

```bash
# After any code change:
npm run build:bundle
git add player/src player/dist
git commit -m "Descriptive message"
git push
```

### 2. Test Locally First

```bash
# Before pushing:
cd player
npm run dev
# Test thoroughly

# Or test in Docker:
npm run build:bundle
../scripts/test-docker.sh
```

### 3. Use Descriptive Commits

```bash
# Good:
git commit -m "Fix volume control for MAX98357A"

# Bad:
git commit -m "updates"
```

### 4. Check Logs After Update

```bash
# On Pi, after every update:
sudo journalctl -u musicbox-player -f
```

Watch for errors in the first 30 seconds.

### 5. Keep Old Generations

NixOS keeps them automatically, but you can clean up old ones:

```bash
# Keep last 5 generations only
sudo nix-collect-garbage --delete-older-than 30d

# But always keep at least 2-3 for safety!
```

---

## Summary

**One-time setup:**
1. Set `GIT_REPO` environment variable
2. Build and flash SD card image (once!)

**Every update:**
1. Make changes, build bundle
2. Commit `dist/` and push to Git
3. SSH to Pi: `nixos-rebuild switch`
4. Done! No reflashing needed.

**If something breaks:**
- Rollback: `nixos-rebuild switch --rollback`
- Previous version restored instantly

**This workflow is perfect for:**
- ✅ Iterating on player code
- ✅ Fixing bugs
- ✅ Adding features
- ✅ Updating audio configuration
- ✅ Managing multiple devices (same code, different configs)

No more waiting 40 minutes to test a one-line change! 🚀
