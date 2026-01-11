# WiFi Embedding in Generic Images

## Overview

The MusicBox generic image builder now supports embedding WiFi credentials directly into the image at build time. This allows Raspberry Pi devices to connect to your WiFi network automatically on first boot, eliminating the need for Ethernet cables or monitors during initial setup.

## Quick Start

### Build Image with WiFi

```bash
cd player/image-building

node --experimental-transform-types build-generic-image.ts \
  --wifi-ssid "YourNetworkName" \
  --wifi-password "YourWiFiPassword"
```

### Setup Process

1. **Flash the image** to SD card
2. **Boot the Pi** - it connects to WiFi automatically
3. **SSH in**: `ssh root@musicbox.local`
4. **Run setup wizard**: `/root/setup-musicbox.sh`
   - WiFi step is automatically skipped
   - Only prompted for device configuration (ID, name, secret, server)

## When to Use WiFi Embedding

### ✅ Good Use Cases

1. **Multiple devices on the same network**
   - Deploying several MusicBox players in one location
   - All devices use the same WiFi credentials
   - Example: Multiple rooms in a house or building

2. **Headless setup without Ethernet**
   - Raspberry Pi Zero 2 W doesn't have built-in Ethernet
   - No need to buy USB Ethernet adapters
   - No need for monitor/keyboard

3. **Rapid deployment**
   - Flash multiple SD cards
   - Boot all Pis simultaneously
   - All connect to network automatically
   - Run setup wizard on each to configure device-specific details

4. **Private deployments**
   - You control all the hardware
   - SD cards won't leave your possession
   - Network security is already established

### ❌ When NOT to Use WiFi Embedding

1. **Different networks per device**
   - Devices deployed at different locations
   - Each location has different WiFi credentials
   - Solution: Build without WiFi, configure during setup

2. **Public distribution**
   - Sharing images with others
   - Don't want WiFi password in the image
   - Solution: Build without WiFi

3. **Maximum security**
   - Want to minimize secrets in the image
   - Each device should have unique configuration
   - Solution: Build without WiFi

4. **Testing/development**
   - Frequently changing networks
   - Need flexibility
   - Solution: Build without WiFi

## Security Considerations

### What Gets Embedded

When you build with WiFi:

```
/etc/nixos/secrets.nix contains:
{
  wifi = {
    ssid = "YourNetwork";
    password = "YourPassword";
  };
}
```

This file is:
- Readable by root
- Included in the SD card filesystem
- Part of the .img file

### Security Implications

**Anyone with access to:**
- The .img file
- The SD card
- Root access on the Pi

**Can read:**
- Your WiFi SSID
- Your WiFi password

### Best Practices

1. **Use WPA2/WPA3 Enterprise** if possible (more secure than PSK)
2. **Isolate MusicBox devices** on a separate VLAN
3. **Use strong WiFi passwords** (even if embedded)
4. **Don't share the image file** publicly
5. **Consider the image as sensitive** as the WiFi password itself

### Alternative: Device-Specific WiFi

If each device needs different WiFi credentials:

```bash
# Build generic image WITHOUT WiFi
node build-generic-image.ts

# On each Pi, during setup wizard, enter unique WiFi credentials
/root/setup-musicbox.sh
```

## How It Works

### Build Time

1. You provide `--wifi-ssid` and `--wifi-password`
2. Builder generates `/etc/nixos/secrets.nix` with WiFi credentials
3. Builder generates `/etc/nixos/configuration.nix` that imports secrets
4. NixOS configuration includes `networking.wireless` setup
5. Image is created with WiFi pre-configured

### First Boot

1. Pi boots from SD card
2. NixOS loads configuration
3. `networking.wireless` service starts
4. Connects to WiFi automatically
5. mDNS advertises `musicbox.local`
6. You can SSH in without Ethernet

### Setup Wizard

1. Wizard detects `/etc/nixos/secrets.nix` exists
2. Checks if WiFi configuration is present
3. Skips WiFi prompts if already configured
4. Preserves existing WiFi credentials
5. Only asks for device-specific configuration

## Comparison: With vs Without WiFi

| Aspect | Without WiFi | With WiFi |
|--------|-------------|-----------|
| **Build command** | `build-generic-image.ts` | `build-generic-image.ts --wifi-ssid "..." --wifi-password "..."` |
| **First boot** | No network | Connects to WiFi |
| **Setup method** | Ethernet or monitor needed | SSH via WiFi |
| **Setup wizard** | Prompts for WiFi | Skips WiFi step |
| **Reusability** | Any network | Same network only |
| **Security** | No WiFi password in image | WiFi password in image |
| **Distribution** | Safe to share | Private only |

## Example Workflows

### Workflow 1: Single Location, Multiple Devices

**Scenario:** Deploying 5 MusicBox players in a home.

```bash
# Build once with WiFi
cd player/image-building
node build-generic-image.ts \
  --wifi-ssid "HomeNetwork" \
  --wifi-password "MySecurePassword"

# Flash 5 SD cards
for i in {1..5}; do
  sudo dd if=outputs/musicbox-generic.img of=/dev/disk${i} bs=4m
done

# Boot all 5 Pis
# Each connects to WiFi automatically

# Configure each device
ssh root@musicbox.local
/root/setup-musicbox.sh
# Enter: device ID 1, name "living-room", secret, server URL

# Rename hostname, reboot, next device
ssh root@musicbox.local  # (connects to next unconfigured Pi)
/root/setup-musicbox.sh
# Enter: device ID 2, name "bedroom", secret, server URL

# Repeat for all 5 devices
```

### Workflow 2: Multiple Locations, Different Networks

**Scenario:** Deploying MusicBox players at 3 different homes.

```bash
# Build once WITHOUT WiFi
cd player/image-building
node build-generic-image.ts

# Flash 3 SD cards with same image
sudo dd if=outputs/musicbox-generic.img of=/dev/disk1 bs=4m
sudo dd if=outputs/musicbox-generic.img of=/dev/disk2 bs=4m
sudo dd if=outputs/musicbox-generic.img of=/dev/disk3 bs=4m

# At Location 1
# Use Ethernet for initial setup
ssh root@musicbox.local
/root/setup-musicbox.sh
# Enter: WiFi for Location 1, device config

# At Location 2
# Use Ethernet for initial setup
ssh root@musicbox.local
/root/setup-musicbox.sh
# Enter: WiFi for Location 2, device config

# At Location 3
# Use Ethernet for initial setup
ssh root@musicbox.local
/root/setup-musicbox.sh
# Enter: WiFi for Location 3, device config
```

### Workflow 3: Automated Configuration

**Scenario:** Fully automated setup for a school with 20 devices.

```bash
# Build with WiFi
node build-generic-image.ts \
  --wifi-ssid "SchoolNetwork" \
  --wifi-password "School2024!"

# Create device config files
for i in {1..20}; do
  cat > device-${i}-config.json <<EOF
{
  "deviceId": ${i},
  "deviceName": "classroom-${i}",
  "deviceSecret": "$(uuidgen)",
  "serverUrl": "http://school-server.local:3000",
  "enableGitUpdates": true,
  "gitRepo": "school/musicbox"
}
EOF
done

# Flash all SD cards
# Boot all Pis
# They all connect to WiFi automatically

# Automated setup for each device
for i in {1..20}; do
  # Wait for Pi to boot
  while ! ping -c 1 musicbox.local &>/dev/null; do sleep 1; done

  # Copy config and run setup
  scp device-${i}-config.json root@musicbox.local:/root/
  ssh root@musicbox.local "/root/setup-musicbox.sh --from-file /root/device-${i}-config.json"

  # Wait for reboot
  sleep 60
done
```

## Troubleshooting

### WiFi Doesn't Connect on Boot

**Check:**
1. WiFi credentials are correct
2. Network is 2.4 GHz (Pi Zero 2 W doesn't support 5 GHz)
3. WPA2 PSK is used (not WPA Enterprise)
4. SSID is not hidden

**Debug:**
```bash
# Connect via Ethernet or monitor
ssh root@musicbox.local

# Check WiFi status
sudo systemctl status wpa_supplicant

# Check network interfaces
ip addr show

# Check WiFi config
cat /etc/nixos/secrets.nix
cat /etc/nixos/configuration.nix | grep -A5 "networking.wireless"

# Try manual connection
sudo wpa_supplicant -B -i wlan0 -c <(wpa_passphrase "SSID" "password")
```

### Setup Wizard Still Asks for WiFi

**Possible causes:**
1. `secrets.nix` doesn't exist
2. `secrets.nix` exists but doesn't have WiFi section
3. Permissions issue reading `secrets.nix`

**Fix:**
```bash
# Check if secrets.nix exists
ls -la /etc/nixos/secrets.nix

# Check contents
cat /etc/nixos/secrets.nix

# If missing, WiFi wasn't embedded - configure manually
/root/setup-musicbox.sh
```

### Want to Change WiFi After Setup

**Option 1: Edit and rebuild configuration**
```bash
ssh root@musicbox-device.local

# Edit secrets
sudo nano /etc/nixos/secrets.nix
# Update wifi.ssid and wifi.password

# Apply
sudo nixos-rebuild switch

# Reboot
sudo reboot
```

**Option 2: Re-run setup wizard**
```bash
# This will overwrite all configuration
sudo /root/setup-musicbox.sh
```

## FAQ

**Q: Can I embed WiFi but still use the same image on different networks?**

A: No. The WiFi credentials are fixed in the image. For different networks, build without WiFi and configure during setup.

**Q: Can I change the WiFi password later?**

A: Yes, edit `/etc/nixos/secrets.nix` and run `sudo nixos-rebuild switch`.

**Q: Is the WiFi password encrypted in the image?**

A: No, it's stored in plain text in `/etc/nixos/secrets.nix`. This is a NixOS limitation.

**Q: Can I use WPA Enterprise?**

A: Yes, but you'll need to manually edit the NixOS configuration. WPA PSK is the default for simplicity.

**Q: Does embedding WiFi reduce security?**

A: It adds a security consideration - anyone with the SD card can read the WiFi password. Use network isolation and strong passwords.

**Q: Can I build one image with WiFi for Device A and one without for Device B?**

A: Yes, build two images:
```bash
# Image 1: With WiFi
node build-generic-image.ts --wifi-ssid "..." --wifi-password "..."
mv outputs/musicbox-generic.img outputs/musicbox-with-wifi.img

# Image 2: Without WiFi
node build-generic-image.ts
mv outputs/musicbox-generic.img outputs/musicbox-no-wifi.img
```

## Summary

WiFi embedding is a powerful feature for deployments where:
- Multiple devices use the same network
- You want plug-and-play setup
- You control all hardware
- Security trade-offs are acceptable

For maximum flexibility and security, build without WiFi and configure during setup.

Choose the approach that best fits your deployment scenario!
