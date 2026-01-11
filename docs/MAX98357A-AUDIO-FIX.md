# MAX98357A Audio Fix for Raspberry Pi Zero 2 W

## The Problem

The MAX98357A is an **I2S digital audio amplifier**, not a standard audio device. It requires:
1. ✅ Hardware I2S pins (GPIO 18, 19, 21)
2. ❌ **Device tree overlay to enable I2S** (MISSING!)
3. ❌ **Correct ALSA card configuration** (MISSING!)
4. ✅ GPIO 22 for shutdown control (already in your code!)

**Your current NixOS module has PipeWire configured but NO I2S hardware support!**

---

## Quick Diagnosis

SSH to your Pi and run these commands to check the current state:

```bash
# 1. Check if I2S device tree is loaded
dtoverlay -l
# Should see: hifiberry-dac or googlevoicehat-soundcard
# ❌ If not listed = I2S not enabled!

# 2. List audio cards
aplay -l
# Should see: card 0: sndrpihifiberry or similar
# ❌ If you only see "bcm2835" (HDMI/headphone) = I2S card not detected!

# 3. Check ALSA devices
cat /proc/asound/cards
# Should show I2S card as card 0 or card 1

# 4. Test volume control
pactl list sinks
# Should show at least one sink

# 5. Check GPIO access for amplifier shutdown
gpioget gpiochip0 22
# Should return 0 or 1 (means GPIO accessible)
```

---

## The Fix

### Step 1: Update NixOS Module for I2S

The `nixos-module.nix` needs I2S hardware configuration. Here's what's missing:

**Problem in current config:**
```nix
# Current asound.conf assumes hw:0,0 exists
# But the I2S card might be a different number!
environment.etc."asound.conf".text = ''
  pcm.!default {
    type plug
    slave.pcm "hw:0,0"  # ❌ Wrong device!
  }
```

**What you need:**
1. Enable I2S device tree overlay
2. Set I2S as default audio output
3. Configure ALSA to find the correct card automatically

---

## Solution Options

### Option A: Using NixOS `hardware.raspberry-pi` Module (Recommended)

If your NixOS has the raspberry-pi hardware module:

```nix
# In your Pi's /etc/nixos/configuration.nix (or imported module)

# Enable I2S for MAX98357A
hardware.raspberry-pi."4".audio.enable = true;  # Also works for Zero 2 W
hardware.raspberry-pi."4".i2s = {
  enable = true;
};

# Load HiFiBerry DAC overlay (compatible with MAX98357A)
hardware.deviceTree = {
  enable = true;
  overlays = [
    {
      name = "hifiberry-dac";
      dtsText = ''
        /dts-v1/;
        /plugin/;

        / {
          compatible = "brcm,bcm2835";
          fragment@0 {
            target = <&i2s>;
            __overlay__ {
              status = "okay";
            };
          };

          fragment@1 {
            target-path = "/";
            __overlay__ {
              pcm5102a-codec {
                #sound-dai-cells = <0>;
                compatible = "ti,pcm5102a";
                status = "okay";
              };
            };
          };

          fragment@2 {
            target = <&sound>;
            __overlay__ {
              compatible = "hifiberry,hifiberry-dac";
              i2s-controller = <&i2s>;
              status = "okay";
            };
          };
        };
      '';
    }
  ];
};
```

### Option B: Using boot.loader.raspberryPi.firmwareConfig (Simpler)

If you don't have the hardware module, use firmware config:

```nix
# Add to your NixOS configuration

# Enable I2S audio via device tree
boot.loader.raspberryPi = {
  enable = true;
  version = 3;  # Pi Zero 2 W is based on Pi 3 hardware
  firmwareConfig = ''
    # Disable onboard audio (PWM/headphone jack)
    dtparam=audio=off

    # Enable I2S
    dtparam=i2s=on

    # Load HiFiBerry DAC overlay (MAX98357A compatible)
    dtoverlay=hifiberry-dac
  '';
};
```

### Option C: Manual config.txt (If NixOS doesn't support above)

If your NixOS version doesn't have the `boot.loader.raspberryPi` options, you can manually edit the SD card:

1. Mount the SD card boot partition on another computer
2. Edit `config.txt`:
```ini
# Disable onboard audio
dtparam=audio=off

# Enable I2S
dtparam=i2s=on

# Load HiFiBerry DAC overlay
dtoverlay=hifiberry-dac
```

---

## Updated ALSA Configuration

Update the `asound.conf` in your NixOS module to automatically find the I2S card:

```nix
# Dynamic ALSA configuration that finds the I2S card
environment.etc."asound.conf".text = ''
  # Default PCM device
  pcm.!default {
    type plug
    slave.pcm "output"
  }

  # Default control device
  ctl.!default {
    type hw
    card sndrpihifiberry  # Name of HiFiBerry/MAX98357A card
  }

  # Output routing - try I2S card first, fall back to card 0
  pcm.output {
    type plug
    slave {
      pcm {
        type hw
        card sndrpihifiberry
        device 0
      }
    }
  }
'';
```

**Or use a more robust auto-detection approach:**

```nix
environment.etc."asound.conf".text = ''
  # Automatically use first available PCM device
  defaults.pcm.card 0
  defaults.ctl.card 0
'';
```

---

## Complete Updated NixOS Module

Here's the full updated `nixos-module.nix` with I2S support:

```nix
{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.musicbox-player;

  musicbox-player = pkgs.callPackage ./package.nix {};

  configFile = pkgs.writeText "player.config.json" (builtins.toJSON {
    deviceId = cfg.deviceId;
    deviceName = cfg.deviceName;
    deviceSecret = cfg.deviceSecret;
    serverUrl = cfg.serverUrl;
    httpPort = cfg.httpPort;
  });

in {
  options.services.musicbox-player = {
    enable = mkEnableOption "MusicBox Player service";

    deviceId = mkOption {
      type = types.int;
      description = "Unique device ID from the server";
    };

    deviceName = mkOption {
      type = types.str;
      example = "living-room";
      description = "Human-readable device name";
    };

    deviceSecret = mkOption {
      type = types.str;
      description = "Device authentication secret (UUID)";
    };

    serverUrl = mkOption {
      type = types.str;
      example = "http://192.168.1.100:3000";
      description = "URL of the MusicBox server";
    };

    httpPort = mkOption {
      type = types.port;
      default = 8080;
      description = "HTTP API port for remote control";
    };

    user = mkOption {
      type = types.str;
      default = "musicbox";
      description = "User to run the service as";
    };

    group = mkOption {
      type = types.str;
      default = "musicbox";
      description = "Group to run the service as";
    };
  };

  config = mkIf cfg.enable {
    # ========================================================================
    # AUDIO: MAX98357A I2S Configuration
    # ========================================================================

    # Enable I2S audio hardware
    hardware.deviceTree = {
      enable = true;
      overlays = [
        {
          name = "i2s-max98357a";
          dtsText = ''
            /dts-v1/;
            /plugin/;

            / {
              compatible = "brcm,bcm2835";

              fragment@0 {
                target = <&i2s>;
                __overlay__ {
                  status = "okay";
                };
              };

              fragment@1 {
                target-path = "/";
                __overlay__ {
                  pcm5102a-codec {
                    #sound-dai-cells = <0>;
                    compatible = "ti,pcm5102a";
                    status = "okay";
                  };
                };
              };

              fragment@2 {
                target = <&sound>;
                __overlay__ {
                  compatible = "simple-audio-card";
                  simple-audio-card,name = "MAX98357A";
                  simple-audio-card,format = "i2s";
                  simple-audio-card,bitclock-master = <&dailink0_master>;
                  simple-audio-card,frame-master = <&dailink0_master>;

                  dailink0_master: simple-audio-card,cpu {
                    sound-dai = <&i2s>;
                  };

                  simple-audio-card,codec {
                    sound-dai = <&pcm5102a>;
                  };
                };
              };
            };
          '';
        }
      ];
    };

    # PipeWire with ALSA support
    security.rtkit.enable = true;
    services.pipewire = {
      enable = true;
      alsa.enable = true;
      alsa.support32Bit = false;  # Pi Zero 2 W is 64-bit
      pulse.enable = true;
    };

    # ALSA configuration for MAX98357A
    environment.etc."asound.conf".text = ''
      # Use card 0 (I2S will be first card with onboard audio disabled)
      defaults.pcm.card 0
      defaults.ctl.card 0

      # Default PCM device
      pcm.!default {
        type plug
        slave.pcm "hw:0,0"
      }

      # Default control
      ctl.!default {
        type hw
        card 0
      }
    '';

    # PipeWire configuration to use I2S as default
    environment.etc."pipewire/pipewire.conf.d/99-musicbox.conf".text = ''
      context.objects = [
        {
          factory = adapter
          args = {
            factory.name = support.null-audio-sink
            node.name = "MusicBox-Default"
            node.description = "MusicBox MAX98357A Output"
            media.class = "Audio/Sink"
            audio.position = [ FL FR ]
          }
        }
      ]
    '';

    # ========================================================================
    # USER & PERMISSIONS
    # ========================================================================

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      description = "MusicBox Player service user";
      extraGroups = [ "audio" "i2c" "gpio" ];
    };

    users.groups.${cfg.group} = {};
    users.groups.i2c = {};
    users.groups.gpio = {};

    # I2C and GPIO permissions
    services.udev.extraRules = ''
      SUBSYSTEM=="i2c-dev", GROUP="i2c", MODE="0660"
      SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
      SUBSYSTEM=="gpio", KERNEL=="gpio*", GROUP="gpio", MODE="0660"
    '';

    # ========================================================================
    # SYSTEMD SERVICE
    # ========================================================================

    systemd.services.musicbox-player = {
      description = "MusicBox Player - NFC music player";
      after = [ "network-online.target" "sound.target" "pipewire.service" ];
      wants = [ "network-online.target" ];
      requires = [ "pipewire.service" ];  # Ensure PipeWire is running
      wantedBy = [ "multi-user.target" ];

      path = with pkgs; [
        alsa-utils      # amixer
        pulseaudio      # pactl (PipeWire compat)
        i2c-tools       # i2cdetect
        libgpiod        # gpioset/gpioget
        ffmpeg-full     # ffplay (audio player)
      ];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        SupplementaryGroups = [ "audio" "i2c" "gpio" ];
        ExecStart = "${musicbox-player}/bin/musicbox-player";
        Restart = "always";
        RestartSec = "10";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "full";
        PrivateDevices = false;
        ProtectHome = true;
        ReadWritePaths = [ "/tmp" "/run/musicbox" ];

        Environment = [
          "NODE_ENV=production"
          "TRIGGER_KEYBOARD=false"
          "TRIGGER_HTTP=true"
          "TRIGGER_NFC=true"
          "TRIGGER_BUTTONS=true"
        ];
      };
    };

    # Config file
    systemd.tmpfiles.rules = [
      "d /run/musicbox 0755 ${cfg.user} ${cfg.group} -"
      "L+ /run/musicbox/player.config.json - - - - ${configFile}"
    ];

    # Firewall
    networking.firewall.allowedTCPPorts = [ cfg.httpPort ];
  };
}
```

---

## Verification Steps

After updating your NixOS configuration and running `sudo nixos-rebuild switch`:

### 1. Check I2S Hardware

```bash
# Should show I2S overlay loaded
dtoverlay -l | grep -i i2s

# Should show I2S kernel module
lsmod | grep snd_soc
```

### 2. Check Audio Card

```bash
# Should list MAX98357A or sndrpihifiberry as card 0
aplay -l

# Expected output:
# card 0: sndrpihifiberry [sndrpihifiberry], device 0: HifiBerry DAC HiFi pcm5102a-hifi-0 [HifiBerry DAC HiFi pcm5102a-hifi-0]
```

### 3. Test Audio Output

```bash
# Generate test tone (should hear from speaker)
speaker-test -t sine -f 1000 -c 2 -D hw:0,0

# Or play a WAV file
aplay /usr/share/sounds/alsa/Front_Center.wav
```

### 4. Check Volume Control

```bash
# PipeWire/PulseAudio volume
pactl list sinks
pactl set-sink-volume @DEFAULT_SINK@ 50%

# Or ALSA (might not work with MAX98357A - no hardware mixer)
amixer scontrols
```

### 5. Test GPIO Amplifier Control

```bash
# Enable amplifier (SD pin HIGH)
gpioset gpiochip0 22=1

# Disable amplifier (SD pin LOW)
gpioset gpiochip0 22=0
```

### 6. Check Player Service

```bash
# Service should be running
sudo systemctl status musicbox-player

# Check logs for audio initialization
sudo journalctl -u musicbox-player -f

# Look for:
# ✅ "🔊 Using PipeWire/PulseAudio volume control"
# ✅ "🔌 MAX98357A shutdown control initialized (GPIO 22)"
# ✅ "🔊 Streaming audio..."
```

---

## Common Issues & Fixes

### Issue 1: No audio card detected

**Symptom:**
```bash
aplay -l
# No soundcards found
```

**Fix:**
- Check `dtoverlay -l` to ensure overlay is loaded
- Verify `/boot/config.txt` has `dtoverlay=hifiberry-dac`
- Check `dmesg | grep -i i2s` for errors
- Reboot after changing device tree settings

### Issue 2: Wrong audio card number

**Symptom:**
Audio plays but no sound from speaker (going to HDMI/headphone instead)

**Fix:**
```bash
# Find the I2S card number
aplay -l

# Update asound.conf to use correct card
sudo nano /etc/asound.conf
# Change: slave.pcm "hw:X,0"  (X = your I2S card number)
```

### Issue 3: Volume control doesn't work

**Symptom:**
`pactl set-sink-volume` or `amixer` fails

**Cause:**
MAX98357A has NO software volume control - it's a simple DAC with fixed output!

**Solutions:**
1. **Use ffplay volume filter** (already in your AudioEngine code as fallback)
2. **Hardware gain pins** on MAX98357A:
   - GAIN pin floating = 15dB
   - GAIN to GND = 9dB
   - GAIN to VCC = 12dB
   - GAIN to GPIO = PWM volume control (advanced)
3. **Pre-amp in audio stream** (PipeWire plugin)

### Issue 4: GPIO permissions denied

**Symptom:**
```
Error: gpioset: unable to open gpiochip0: Permission denied
```

**Fix:**
```bash
# Check user is in gpio group
groups musicbox
# Should show: audio i2c gpio

# Check udev rules applied
ls -la /dev/gpiochip0
# Should show: crw-rw---- 1 root gpio

# Restart service after group changes
sudo systemctl restart musicbox-player
```

### Issue 5: Crackling or distorted audio

**Symptoms:**
Audio plays but sounds bad

**Fixes:**
1. **Check power supply** - Pi Zero 2 W needs good 5V/2.5A
2. **Reduce volume** - MAX98357A clips at high levels
3. **Buffer settings** in ffplay:
   ```typescript
   // In AudioEngine, try adding:
   "-bufsize", "512k",
   "-probesize", "32M"
   ```
4. **Clock issues** - Ensure clean 5V to MAX98357A VIN

---

## MAX98357A Wiring Reference

Verify your connections match this:

| MAX98357A Pin | Pi Zero 2 W GPIO | Purpose |
|---------------|------------------|---------|
| VIN | 5V (Pin 2 or 4) | Power |
| GND | GND (Pin 6, 9, etc) | Ground |
| DIN | GPIO 21 (Pin 40) | I2S Data |
| BCLK | GPIO 18 (Pin 12) | I2S Bit Clock |
| LRCLK | GPIO 19 (Pin 35) | I2S LR Clock |
| SD | GPIO 22 (Pin 15) | Shutdown (LOW=off, HIGH=on) |
| GAIN | GND or Float | Hardware volume (9dB or 15dB) |

**Critical:**
- ✅ Use 5V from Pi for VIN (not 3.3V!)
- ✅ SD pin (GPIO 22) controls shutdown - already in your code
- ✅ GAIN pin to GND = quieter (9dB), float = louder (15dB)

---

## Testing Checklist

- [ ] I2S device tree overlay loads (`dtoverlay -l`)
- [ ] Audio card detected (`aplay -l` shows I2S card)
- [ ] Speaker test produces sound (`speaker-test`)
- [ ] GPIO amplifier control works (`gpioset gpiochip0 22=1`)
- [ ] PipeWire running (`systemctl status pipewire`)
- [ ] Player service starts (`systemctl status musicbox-player`)
- [ ] Player can stream audio from server
- [ ] Volume control works (even if just ffplay filter)
- [ ] Amplifier shuts down when not playing (power saving)

---

## Next Steps

1. **Update `nixos-module.nix`** with I2S configuration (see complete example above)
2. **Deploy to Pi**: `sudo nixos-rebuild switch`
3. **Run diagnostics**: Check all items in "Verification Steps"
4. **Test playback**: Trigger an NFC card scan
5. **Debug**: Check `journalctl -u musicbox-player -f` for errors

If audio still doesn't work after this, run the diagnostic script (next section) and share the output!
