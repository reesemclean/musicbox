# Raspberry Pi Setup & Management

Managing MusicBox Players on Raspberry Pi.

## Overview

MusicBox uses pre-built SD card images. No manual configuration needed - just flash and boot.

See [CUSTOM-IMAGE.md](CUSTOM-IMAGE.md) for building images.

## Hardware Requirements

- **Raspberry Pi 4** (recommended) or Pi 3B+
- **32GB+ microSD card** (Class 10 or better)
- **3A power supply** (official Pi 4 PSU recommended)
- **Network**: WiFi (pre-configured) or Ethernet
- **Optional**: PN532 NFC reader (I2C), Audio output (3.5mm/HDMI/USB)

## First Boot

1. **Flash SD card** with custom image (see [CUSTOM-IMAGE.md](CUSTOM-IMAGE.md))
2. **Insert SD card** into Raspberry Pi
3. **Power on** - wait 2-3 minutes for first boot
4. **Automatic setup**:
   - Connects to pre-configured WiFi
   - Starts MusicBox Player service
   - Registers with server (heartbeat)
   - Appears as "online" in server UI

## Verifying Operation

### Check Server UI

```
http://your-server:3000/devices
```
Device should show status "online" with IP address.

### SSH Access

```bash
# Find IP address
nmap -sn 192.168.1.0/24 | grep musicbox

# Connect
ssh root@192.168.1.31

# Check service
systemctl status musicbox-player

# View logs
journalctl -u musicbox-player -f
```

### Test Playback

In server UI:
1. Go to device page
2. Click "Play" on a song
3. Audio should play on Pi

## Management Commands

### Via SSH

```bash
# Restart player
systemctl restart musicbox-player

# Stop player
systemctl stop musicbox-player

# View logs (last 50 lines)
journalctl -u musicbox-player -n 50

# Follow logs live
journalctl -u musicbox-player -f

# Check audio devices
aplay -l

# Test audio
speaker-test -t wav -c 2

# Check WiFi status
iwconfig
nmcli device status

# Reboot
reboot

# Shutdown
poweroff
```

### Via Server UI

- **Play/Pause**: Control playback remotely
- **Next/Previous**: Skip tracks
- **View Status**: Current song, IP address, last seen
- **Restart**: Trigger player restart

## Troubleshooting

### Pi Not Connecting to WiFi

**Symptoms**: Device stays offline, no IP address in server UI

**Solutions**:
1. **Connect via Ethernet**:
   - Plug in Ethernet cable
   - SSH to Pi via Ethernet IP
   - Check WiFi config

2. **Check logs**:
   ```bash
   ssh root@PI_IP
   journalctl -u wpa_supplicant -n 50
   ```

3. **Verify WiFi credentials**:
   - Rebuild image with correct credentials
   - Or manually edit `/etc/nixos/configuration.nix` and run `nixos-rebuild switch`

4. **Check WiFi hardware**:
   ```bash
   iwconfig  # Should show wlan0
   ```

### Player Service Not Starting

**Check status**:
```bash
systemctl status musicbox-player
```

**Common issues**:

1. **Can't reach server**:
   ```bash
   # Test connectivity
   curl http://your-server:3000/api/devices/heartbeat
   ```
   - Check server URL in config
   - Verify firewall allows outbound HTTP

2. **Wrong device secret**:
   - Check server logs for auth errors
   - Verify device secret matches server

3. **Audio device not found**:
   ```bash
   aplay -l  # List audio devices
   ```
   - Try different output (HDMI vs 3.5mm)
   - Check `alsamixer` volume levels

### Can't SSH

1. **Verify Pi is on network**:
   ```bash
   ping 192.168.1.31
   ```

2. **Check SSH key**:
   - Ensure you used correct public key when building image
   - Try different SSH client

3. **Port blocked**:
   - Check router firewall
   - Try from different network device

### Audio Not Working

1. **Check audio output**:
   ```bash
   aplay -l                    # List devices
   speaker-test -t wav -c 2    # Test audio
   alsamixer                   # Adjust volume
   ```

2. **Set default audio device**:
   ```bash
   # Use HDMI
   amixer cset numid=3 2
   
   # Use 3.5mm jack
   amixer cset numid=3 1
   ```

3. **Check player logs**:
   ```bash
   journalctl -u musicbox-player | grep audio
   ```

### NFC Reader Not Working

1. **Check I2C connection**:
   ```bash
   i2cdetect -y 1
   # Should show device at 0x24
   ```

2. **Check hardware**:
   - Verify PN532 wiring (SDA, SCL, GND, 3.3V)
   - Try different I2C address

3. **Check player logs**:
   ```bash
   journalctl -u musicbox-player | grep NFC
   ```

## Updating Player Software

### Method 1: Rebuild Image (Clean)

Best for major updates:

```bash
# On your computer
cd player
npm run build:bundle
git commit -am "Update player"

cd ..
npm run build:image -- ./device-configs/device.config.json --wifi ./wifi.json --ssh ./ssh.json

# Flash new image to SD card
sudo dd if=outputs/device.img of=/dev/diskX bs=4M status=progress
```

### Method 2: SSH Update (Fast)

For quick code updates:

```bash
# Build new bundle
cd player
npm run build:bundle

# Copy to Pi
scp dist/musicbox-player.js root@PI_IP:/tmp/

# SSH and replace
ssh root@PI_IP
# Find current binary location
systemctl cat musicbox-player | grep ExecStart
# Copy new version
cp /tmp/musicbox-player.js /nix/store/HASH-musicbox-player/bin/musicbox-player
systemctl restart musicbox-player
```

### Method 3: NixOS Rebuild (Proper)

For system-level changes:

```bash
# SSH to Pi
ssh root@PI_IP

# Edit configuration
nano /etc/nixos/configuration.nix

# Rebuild system
nixos-rebuild switch

# Service auto-restarts
```

## Performance Tuning

### Audio Latency

Edit `/etc/nixos/configuration.nix`:
```nix
# Lower audio latency
services.pulseaudio.daemon.config = {
  default-fragments = "2";
  default-fragment-size-msec = "5";
};
```

Apply: `nixos-rebuild switch`

### CPU Governor

For better audio performance:
```bash
# Set to performance mode
echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

## Monitoring

### System Stats

```bash
# CPU/Memory
htop

# Disk usage
df -h

# Network
iftop

# Temperature
vcgencmd measure_temp
```

### Player Stats

```bash
# Current playback
curl http://localhost:8080/status

# Logs
journalctl -u musicbox-player --since "1 hour ago"
```

## Multiple Devices

### Same WiFi Network

All devices get IP addresses from router DHCP.

**Identify devices**:
```bash
# By hostname (from build config)
ssh root@musicbox-SSID.local

# By IP (check router)
nmap -sn 192.168.1.0/24 | grep Raspberry
```

### Different WiFi Networks

Build separate images with different WiFi configs:

```bash
npm run build:image -- ./device-configs/living-room.json --wifi ./wifi-home.json --ssh ./ssh.json
npm run build:image -- ./device-configs/bedroom.json --wifi ./wifi-guest.json --ssh ./ssh.json
```

## Backup & Recovery

### Backup SD Card

```bash
# Full image backup
sudo dd if=/dev/diskX of=musicbox-backup.img bs=4M status=progress

# Compress
gzip musicbox-backup.img
```

### Restore from Backup

```bash
gunzip musicbox-backup.img.gz
sudo dd if=musicbox-backup.img of=/dev/diskX bs=4M status=progress
```

### Config Backup

```bash
# Backup config only
ssh root@PI_IP "cat /etc/nixos/configuration.nix" > config-backup.nix
```

## Security

### Change Root Password (Optional)

```bash
ssh root@PI_IP
passwd
```

### Disable Root Login

Edit `/etc/nixos/configuration.nix`:
```nix
services.openssh.settings.PermitRootLogin = "no";

# Create admin user
users.users.admin = {
  isNormalUser = true;
  extraGroups = [ "wheel" ];
  openssh.authorizedKeys.keys = [ "ssh-ed25519 ..." ];
};
```

Apply: `nixos-rebuild switch`

### Firewall

Default config only allows SSH (22) and Player HTTP (8080).

To open additional ports:
```nix
networking.firewall.allowedTCPPorts = [ 22 8080 9090 ];
```

## Advanced

### Serial Console Access

Connect USB-to-TTL adapter:
- TX → Pi RX (Pin 10)
- RX → Pi TX (Pin 8)  
- GND → Pi GND (Pin 6)

```bash
screen /dev/tty.usbserial 115200
```

### Read-Only Root Filesystem

For SD card longevity:
```nix
fileSystems."/".options = [ "ro" ];
```

### Automatic Updates

Add to `/etc/nixos/configuration.nix`:
```nix
system.autoUpgrade = {
  enable = true;
  dates = "03:00";  # 3 AM daily
};
```

## Next Steps

- [CUSTOM-IMAGE.md](CUSTOM-IMAGE.md) - Building custom images
- [DEPLOYMENT.md](../DEPLOYMENT.md) - Deployment architecture
