# MusicBox Generic Image - Quick Start Guide

The **generic image** approach is the simplest way to deploy MusicBox players to Raspberry Pi devices.

## Why Generic Image?

**Build once, use everywhere:**
- ✅ Single image works for ALL devices
- ✅ No device-specific secrets in the image
- ✅ Flash and configure in minutes
- ✅ Can reflash and re-setup anytime
- ✅ No complex build process per device

---

## Quick Start

### 1. Build Generic Image (Once Ever)

```bash
# Build the player bundle
cd player
npm run build:bundle
cd ..

# Commit the bundle
git add player/dist
git commit -m "Build player bundle"
git push origin main

# Build generic image
cd player/image-building

# Option A: No WiFi embedded (setup wizard will prompt)
node --experimental-transform-types build-generic-image.ts

# Option B: WiFi pre-configured (Pi connects automatically on boot)
node --experimental-transform-types build-generic-image.ts \
  --wifi-ssid "YourNetworkName" \
  --wifi-password "YourWiFiPassword"

# Output: outputs/musicbox-generic.img (~2GB)
```

**WiFi Options:**
- **No WiFi**: Use Ethernet or monitor/keyboard for initial setup
- **WiFi embedded**: Pi connects to WiFi automatically on first boot, making setup via `musicbox.local` seamless

**💡 Tip:** See `build-with-wifi-example.sh` for a ready-to-use script template.

**This takes 20-40 minutes the first time.** Subsequent builds are faster.

You only need to rebuild if:
- You update the player code
- You update the NixOS module
- You want to update system packages

---

### 2. Flash to SD Card

```bash
# Find your SD card
diskutil list

# Flash the image (use rdiskX for faster writing)
sudo dd if=outputs/musicbox-generic.img of=/dev/rdiskX bs=4m status=progress

# Eject
diskutil eject /dev/diskX
```

**You can flash this same image to multiple Pis!**

---

### 3. First Boot Setup

#### a) Boot the Pi

1. Insert SD card into Raspberry Pi Zero 2 W
2. Connect MAX98357A speaker (if not already)
3. Power on
4. Wait 2-3 minutes for first boot

#### b) Connect to Network

**If WiFi was embedded in the image:**
- Pi will connect to WiFi automatically
- Wait 1-2 minutes for network to establish

**If WiFi was NOT embedded:**
- Use USB Ethernet adapter for initial setup, OR
- Use monitor/keyboard to configure directly on the Pi

#### c) SSH Into the Pi

```bash
ssh root@musicbox.local
```

**No password needed** - uses your SSH key from the build.

#### d) Run Setup Wizard

```bash
/root/setup-musicbox.sh
```

The wizard asks for:
1. **WiFi SSID and password** (skipped if WiFi was embedded in the image)
2. **Device information** (from your MusicBox server)
   - Device ID
   - Device Name
   - Device Secret (UUID)
   - Server URL
3. **Update strategy**
   - Enable Git updates? (recommended: yes)
   - Git repository (default: reesemclean/musicbox)

**Example interaction:**
```
╔════════════════════════════════════════════════════════════════╗
║         MusicBox Player - First-Boot Setup Wizard             ║
╚════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Step 1: WiFi Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WiFi SSID: MyNetwork
WiFi Password: ********

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Step 2: Device Registration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Device ID (from server): 1
Device Name (e.g., living-room): living-room
Device Secret (UUID from server): abc-123-456-789
Server URL [http://192.168.1.100:3000]:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Step 3: Update Strategy
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Enable Git-based updates? (y/N): y
Git repository [reesemclean/musicbox]:

...

✓ Setup Complete! 🎉

Rebooting in 10 seconds...
```

The Pi will reboot and the MusicBox player will start automatically!

---

## WiFi Embedding: Pros and Cons

### When to Embed WiFi

**✅ Embed WiFi if:**
- You're deploying multiple devices on the same network
- You want plug-and-play setup (no Ethernet needed)
- All devices will use the same WiFi network

**❌ Don't embed WiFi if:**
- Devices will be deployed on different networks
- You're distributing images publicly
- You want maximum security (WiFi password in image)

### Security Considerations

When WiFi is embedded:
- WiFi password is stored in `/etc/nixos/secrets.nix` on the Pi
- Anyone with the SD card can read the WiFi password
- The image file itself contains the WiFi password

**Best practice:** Only embed WiFi for private deployments where you control all the hardware.

For public distribution or devices on different networks, build without WiFi and let users configure during setup.

---

## After Setup

### Check Player Status

```bash
ssh root@musicbox-living-room.local

# Check service
sudo systemctl status musicbox-player

# View logs
sudo journalctl -u musicbox-player -f
```

### Update Player (If Git Updates Enabled)

```bash
# On your laptop
cd player
npm run build:bundle
git add player/src player/dist
git commit -m "Fix audio bug"
git push origin main

# On the Pi
ssh root@musicbox-living-room.local
sudo nixos-rebuild switch

# Player updates automatically!
```

---

## Advanced: Automated Setup

### Using Config File

Create `device-config.json`:
```json
{
  "wifiSsid": "MyNetwork",
  "wifiPassword": "MyPassword123",
  "deviceId": 1,
  "deviceName": "living-room",
  "deviceSecret": "abc-123-456-789",
  "serverUrl": "http://192.168.1.100:3000",
  "enableGitUpdates": true,
  "gitRepo": "reesemclean/musicbox"
}
```

Copy to Pi and run:
```bash
scp device-config.json root@musicbox.local:/root/
ssh root@musicbox.local
/root/setup-musicbox.sh --from-file /root/device-config.json
```

No prompts needed - fully automated!

---

## Troubleshooting

### Can't SSH to musicbox.local

**Problem:** mDNS not working

**Solutions:**
1. Find IP address via router admin
2. Use Ethernet temporarily
3. Connect monitor/keyboard

### Setup wizard fails

**Check logs:**
```bash
# If still in SSH session
journalctl -xe

# Check network
ping google.com

# Check server reachable
curl http://your-server:3000
```

**Common issues:**
- Wrong WiFi password
- Server URL not reachable from Pi's network
- Git repo is private (needs SSH key setup for private repos)

### Git updates fail

**Problem:** Can't fetch from private repo

**Fix:** Set up SSH key on Pi
```bash
ssh root@musicbox-device.local

# Generate key
ssh-keygen -t ed25519 -f /root/.ssh/id_musicbox

# Add to GitHub as deploy key
cat /root/.ssh/id_musicbox.pub
# Copy and add to: github.com/user/repo/settings/keys

# Update configuration to use SSH URL
sudo nano /etc/nixos/configuration.nix
# Change: url = "git@github.com:user/repo.git";
sudo nixos-rebuild switch
```

### Want to re-setup

Just reflash the same generic image and run the wizard again!

```bash
# Flash same image
sudo dd if=outputs/musicbox-generic.img of=/dev/rdiskX bs=4m

# Boot, SSH, run wizard
ssh root@musicbox.local
/root/setup-musicbox.sh
```

---

## Workflow Summary

### Initial Setup (WiFi Embedded)
```
Build generic image with WiFi (once)
    ↓
Flash to SD card (reusable image!)
    ↓
Boot Pi → Connects to WiFi automatically
    ↓
SSH in via musicbox.local
    ↓
Run setup wizard
    ↓
Configure device ID, name, secret, Git updates
    ↓
Reboot
    ↓
Player auto-starts!
```

### Initial Setup (No WiFi)
```
Build generic image without WiFi (once)
    ↓
Flash to SD card (reusable image!)
    ↓
Boot Pi
    ↓
Connect via Ethernet or monitor/keyboard
    ↓
SSH in via musicbox.local
    ↓
Run setup wizard
    ↓
Configure WiFi, device, Git updates
    ↓
Reboot
    ↓
Player auto-starts!
```

### Updates (With Git Enabled)
```
Make code changes
    ↓
Build bundle & commit
    ↓
Push to Git
    ↓
SSH to Pi
    ↓
sudo nixos-rebuild switch
    ↓
Player updates automatically
```

### Deploy to Multiple Devices
```
Flash same image to N devices
    ↓
Run wizard on each (different device configs)
    ↓
All devices ready!
```

---

## Comparison: Generic vs Device-Specific Images

| Aspect | Generic Image | Device-Specific Image |
|--------|---------------|----------------------|
| **Build time** | Once (~30 min) | Per device (~30 min each) |
| **Reusability** | ∞ devices | 1 device |
| **Secrets** | Entered on device | Embedded in image |
| **Setup** | Flash + 5 min wizard | Flash + boot (done!) |
| **Re-setup** | Reflash same image | Rebuild entire image |
| **Distribution** | Can share publicly | Can't share (has secrets) |
| **Updates** | Via Git (no reflash) | Via Git (no reflash) |

---

## Best Practices

1. **Build generic image periodically**
   - When you update player code
   - When you update system packages
   - Keep the latest .img file backed up

2. **Use Git updates in production**
   - Much faster than reflashing
   - Can roll back easily
   - Deploy to multiple devices quickly

3. **Keep device configs**
   - Save device-config.json files for each device
   - Allows automated re-setup if needed
   - Good for disaster recovery

4. **Test setup wizard changes**
   - Flash test Pi
   - Run wizard
   - Verify everything works before distributing

---

## Next Steps

- **For development:** Keep using `npm run dev` locally
- **For testing:** Use Docker testing workflow
- **For production:** Use generic image + setup wizard
- **For updates:** Use `nixos-rebuild switch` (no reflashing!)

This workflow gives you the best of both worlds:
- Simple, reusable image building
- Flexible, device-specific configuration
- Fast updates without reflashing

🎉 Happy deploying!
