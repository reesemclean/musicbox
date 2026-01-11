# Quick Audio Fix - MAX98357A on Pi Zero 2 W

## The Problem

Your MAX98357A speaker isn't working because the **I2S hardware interface isn't enabled** in your NixOS configuration.

## The Solution (3 Steps)

### Step 1: Update Your Code

The updated `player/image-building/nixos-module.nix` now includes:
- ✅ I2S device tree overlay for MAX98357A
- ✅ Proper ALSA card configuration
- ✅ PipeWire with PulseAudio compatibility
- ✅ ffplay in the service PATH
- ✅ All necessary audio tools (pactl, amixer, etc.)

**Commit and push the changes:**

```bash
cd /Users/reesemclean/Projects/musicbox

git add player/image-building/nixos-module.nix
git add docs/MAX98357A-AUDIO-FIX.md
git add docs/QUICK-AUDIO-FIX.md
git add player/scripts/diagnose-audio.sh

git commit -m "Add I2S support for MAX98357A audio on Pi Zero 2 W"
git push origin main
```

### Step 2: Deploy to Your Pi

SSH to your Raspberry Pi and rebuild:

```bash
# SSH to the Pi
ssh youruser@musicbox-pi.local

# Rebuild with updated configuration
sudo nixos-rebuild switch

# Reboot to ensure device tree changes take effect
sudo reboot
```

**Why reboot?** Device tree overlays are loaded at boot time, so a reboot is needed for I2S hardware to be recognized.

### Step 3: Verify Audio Works

After reboot, SSH back in and run diagnostics:

```bash
ssh youruser@musicbox-pi.local

# Run diagnostic script (if you deployed it)
./diagnose-audio.sh

# Or manually check:

# 1. Check audio cards
aplay -l
# Should see: sndrpihifiberry or simple-card (not just bcm2835)

# 2. Test speaker
speaker-test -t sine -f 1000 -c 2
# Press Ctrl+C after you hear the tone

# 3. Check MusicBox service
sudo systemctl status musicbox-player
sudo journalctl -u musicbox-player -f

# 4. Test with an NFC card scan!
```

---

## Verification Checklist

After deploying, verify these are ✅:

```bash
# I2S overlay loaded
dtoverlay -l | grep i2s
# ✅ Should see: i2s-max98357a

# I2S audio card detected
aplay -l
# ✅ Should see: card 0: sndrpihifiberry or MAX98357A
# ❌ If only "bcm2835": I2S not working, reboot needed

# PipeWire running
systemctl status pipewire
# ✅ Should be: active (running)

# GPIO accessible
gpioget gpiochip0 22
# ✅ Should return: 0 or 1

# Service running
systemctl status musicbox-player
# ✅ Should be: active (running)

# Audio working
speaker-test -t sine -f 1000
# ✅ Should hear: tone from speaker
```

---

## Troubleshooting

### Issue: Still no I2S card after reboot

**Check device tree compilation:**

```bash
# Look for device tree errors in boot log
dmesg | grep -i "device tree"
dmesg | grep -i i2s

# Check if overlay applied
ls -la /sys/firmware/devicetree/base/
```

**If device tree overlay didn't work**, try the alternative approach:

Edit `/boot/config.txt` directly on the SD card boot partition:

```ini
# Disable onboard audio
dtparam=audio=off

# Enable I2S
dtparam=i2s=on

# Load HiFiBerry overlay (MAX98357A compatible)
dtoverlay=hifiberry-dac
```

### Issue: Audio card exists but no sound

**Check wiring:**

| MAX98357A Pin | Pi Zero 2 W | GPIO |
|---------------|-------------|------|
| VIN | 5V Pin 2 | Power |
| GND | GND Pin 6 | Ground |
| DIN | Pin 40 | GPIO 21 |
| BCLK | Pin 12 | GPIO 18 |
| LRCLK | Pin 35 | GPIO 19 |
| SD | Pin 15 | GPIO 22 |
| GAIN | Float or GND | Volume (15dB or 9dB) |

**Test manually:**

```bash
# Enable amplifier
gpioset gpiochip0 22=1

# Play test tone
speaker-test -D hw:0,0 -t sine -f 1000

# If still no sound, check hardware:
# - Is 5V power connected to VIN?
# - Are I2S pins (18,19,21) wired correctly?
# - Is GAIN pin configured? (floating = louder, GND = quieter)
```

### Issue: Volume control doesn't work

**This is NORMAL!** The MAX98357A has **no software volume control**.

Options:
1. **Use hardware GAIN pin**: Connect to GND (9dB) or leave floating (15dB)
2. **Use ffplay filter**: Already implemented in your AudioEngine code
3. **Use pre-amp**: Apply volume in PipeWire/ffplay (software mixing)

Your current code handles this automatically - if pactl doesn't work, it falls back to ffplay's volume filter.

### Issue: Service fails to start

**Check logs:**

```bash
sudo journalctl -u musicbox-player -n 50

# Look for common errors:
# - "ffplay: not found" → ffmpeg-full not in PATH (should be fixed now)
# - "Permission denied" (GPIO/i2c) → user not in correct groups
# - "No such file" (config) → config file not created
```

---

## Expected Boot Messages

When everything is working, you should see in the logs:

```
# From journalctl -u musicbox-player:

🎵 MusicBox Player starting...
   Device: living-room (ID: 1)
   Server: http://192.168.1.100:3000

🔊 Using PipeWire/PulseAudio volume control
🔊 Volume control initialized (10%)
🔌 MAX98357A shutdown control initialized (GPIO 22)

✅ NFC reader initialized (I2C address: 0x24)
🌐 HTTP trigger listening on port 8080

⏳ Connecting to server...
✅ Connected to MusicBox server
🎧 Ready! Waiting for NFC card...
```

---

## Next Steps

Once audio is working:

1. **Test volume control**:
   - Call the HTTP API to change volume
   - Or use buttons if configured

2. **Test playback**:
   - Scan an NFC card
   - Watch logs to see audio streaming
   - Verify sound comes from speaker

3. **Fine-tune**:
   - Adjust GAIN pin for desired loudness
   - Configure buttons for physical volume control
   - Test multiple songs

---

## If You Still Have Issues

1. **Run the diagnostic script**:
   ```bash
   bash /path/to/diagnose-audio.sh
   ```

2. **Check the full guide**:
   - Read `docs/MAX98357A-AUDIO-FIX.md` for detailed explanations
   - All options and alternatives are documented there

3. **Share the output**:
   - Post `journalctl -u musicbox-player -n 100`
   - Post `aplay -l` output
   - Share diagnostic script results

Good luck! 🎵
