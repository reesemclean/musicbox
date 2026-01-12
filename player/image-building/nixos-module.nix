{ config, lib, pkgs, ... }:

with lib;

let
  cfg = config.services.musicbox-player;
  
  # Import the player package
  musicbox-player = pkgs.callPackage ./package.nix {};
  
  # Configuration file format
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

    # Note: We use the default kernel (not linux_rpi3) for cross-compilation compatibility
    # The device tree overlay approach works with the mainline kernel
    
    # Enable I2S audio hardware for MAX98357A amplifier
    # This overlay enables I2S and creates the audio card
    hardware.deviceTree = {
      enable = true;
      overlays = [
        # MAX98357A / HiFiBerry DAC compatible overlay
        # Uses target-path for compatibility with mainline kernel DTB
        {
          name = "max98357a-audio-overlay";
          dtsText = ''
            /dts-v1/;
            /plugin/;

            / {
              compatible = "brcm,bcm2837", "brcm,bcm2836", "brcm,bcm2835";

              fragment@0 {
                target-path = "/soc/i2s@7e203000";
                __overlay__ {
                  status = "okay";
                };
              };

              fragment@1 {
                target-path = "/";
                __overlay__ {
                  pcm5102a: pcm5102a-codec {
                    #sound-dai-cells = <0>;
                    compatible = "ti,pcm5102a";
                    status = "okay";
                  };
                };
              };
            };
          '';
        }
      ];
    };

    # Load I2S sound modules
    boot.kernelModules = [ "snd-soc-bcm2835-i2s" "snd-soc-pcm5102a" ];

    # PipeWire audio server (modern replacement for PulseAudio/JACK)
    security.rtkit.enable = true;
    services.pipewire = {
      enable = true;
      alsa.enable = true;
      alsa.support32Bit = false;  # Pi Zero 2 W is 64-bit
      pulse.enable = true;  # PulseAudio compatibility (for pactl)
    };

    # ALSA configuration for MAX98357A I2S card with software volume control
    # Based on Adafruit's recommended configuration
    # https://learn.adafruit.com/adafruit-max98357-i2s-class-d-mono-amp/raspberry-pi-usage
    environment.etc."asound.conf".text = ''
      # Hardware PCM for the I2S DAC
      pcm.speakerbonnet {
        type hw
        card 0
      }

      # Software mixer with dmix for shared access
      pcm.dmixer {
        type dmix
        ipc_key 1024
        ipc_perm 0666
        slave {
          pcm "speakerbonnet"
          period_time 0
          period_size 1024
          buffer_size 8192
          rate 44100
          channels 2
        }
      }

      ctl.dmixer {
        type hw
        card 0
      }

      # Software volume control
      pcm.softvol {
        type softvol
        slave.pcm "dmixer"
        control.name "PCM"
        control.card 0
      }

      ctl.softvol {
        type hw
        card 0
      }

      # Default output goes through software volume
      pcm.!default {
        type plug
        slave.pcm "softvol"
      }

      ctl.!default {
        type hw
        card 0
      }
    '';

    # ========================================================================
    # USER & PERMISSIONS
    # ========================================================================

    # Create user and group
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      description = "MusicBox Player service user";
      extraGroups = [ "audio" "i2c" "gpio" ]; # Audio, I2C for NFC, GPIO for buttons
    };

    users.groups.${cfg.group} = {};

    # Create i2c and gpio groups if they don't exist
    users.groups.i2c = {};
    users.groups.gpio = {};

    # I2C and GPIO permissions via udev
    services.udev.extraRules = ''
      # Allow i2c group to access I2C devices
      SUBSYSTEM=="i2c-dev", GROUP="i2c", MODE="0660"
      # Allow gpio group to access GPIO
      SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
      SUBSYSTEM=="gpio", KERNEL=="gpio*", GROUP="gpio", MODE="0660"
    '';

    # ========================================================================
    # SYSTEMD SERVICE
    # ========================================================================

    # Create systemd service
    systemd.services.musicbox-player = {
      description = "MusicBox Player - NFC music player";
      after = [ "network-online.target" "sound.target" "pipewire.service" ];
      wants = [ "network-online.target" ];
      requires = [ "pipewire.service" ];  # Ensure PipeWire is running
      wantedBy = [ "multi-user.target" ];

      # Add required tools to PATH
      path = with pkgs; [
        alsa-utils      # amixer (ALSA volume control)
        pulseaudio      # pactl (PipeWire/PulseAudio compatibility)
        i2c-tools       # i2cdetect, i2cget (NFC reader)
        libgpiod        # gpioset, gpioget (GPIO control for amplifier)
        ffmpeg-full     # ffplay (audio playback)
      ];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        SupplementaryGroups = [ "audio" "i2c" "gpio" ];  # Ensure group access for hardware
        ExecStart = "${musicbox-player}/bin/musicbox-player";
        Restart = "always";
        RestartSec = "10";
        
        # Security hardening (relaxed for hardware access)
        # NOTE: ProtectSystem=strict hides /dev devices from Node.js existsSync
        # Use "full" instead which protects /usr and /boot but not /dev
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "full";   # "strict" breaks device access
        PrivateDevices = false;   # Need access to I2C, GPIO, sound devices
        ProtectHome = true;       # No need for home directory access
        ReadWritePaths = [ "/tmp" "/run/musicbox" ];
        
        # Environment - point to config in /run
        Environment = [
          "NODE_ENV=production"
          "TRIGGER_KEYBOARD=false"  # Disable keyboard for headless service
          "TRIGGER_HTTP=true"
          "TRIGGER_NFC=true"
          "TRIGGER_BUTTONS=true"
        ];
      };
    };

    # Create config file in /run (writable at runtime)
    systemd.tmpfiles.rules = [
      "d /run/musicbox 0755 ${cfg.user} ${cfg.group} -"
      "L+ /run/musicbox/player.config.json - - - - ${configFile}"
    ];

    # Open firewall port for HTTP API
    networking.firewall.allowedTCPPorts = [ cfg.httpPort ];
  };
}
