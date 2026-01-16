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

    # For I2S audio with MAX98357A on Pi Zero 2 W with mainline kernel:
    # The mainline kernel has the I2S node but it's disabled by default.
    # We need to enable it and add the MAX98357A codec with a sound card.
    #
    # The simplest approach is to use a single consolidated overlay.

    hardware.deviceTree = {
      enable = true;
      filter = "bcm2837-rpi-zero-2*.dtb";
      overlays = [
        {
          name = "i2s-max98357a";
          # Combined I2S + MAX98357A + Sound Card overlay
          dtsText = ''
            /dts-v1/;
            /plugin/;

            / {
              compatible = "raspberrypi,model-zero-2-w", "brcm,bcm2837";
            };

            /* Enable I2S peripheral (has label 'i2s' in base DTB) */
            &i2s {
              #sound-dai-cells = <0>;
              pinctrl-names = "default";
              pinctrl-0 = <&pcm_gpio18>;
              status = "okay";
            };

            /* Add MAX98357A codec and sound card at root */
            &{/} {
              max98357a: max98357a {
                compatible = "maxim,max98357a";
                #sound-dai-cells = <0>;
                status = "okay";
              };

              sound: sound {
                compatible = "simple-audio-card";
                simple-audio-card,name = "MAX98357A";
                simple-audio-card,format = "i2s";
                status = "okay";

                simple-audio-card,cpu {
                  sound-dai = <&i2s>;
                };

                simple-audio-card,codec {
                  sound-dai = <&max98357a>;
                };
              };
            };
          '';
        }
      ];
    };

    # Ensure the I2S and MAX98357A kernel modules are available
    boot.kernelModules = [ "snd-soc-bcm2835-i2s" "snd-soc-max98357a" "snd-soc-simple-card" ];

    # Pure ALSA - no PipeWire needed for headless player
    # This is simpler and lighter for embedded use
    hardware.alsa.enable = true;

    # ALSA configuration for MAX98357A I2S card
    # The I2S card will be card 0 (with onboard audio disabled)
    # Uses dmix for mixing multiple audio sources (music + tones)
    # MAX98357A has no hardware volume control, so we use ALSA softvol plugin
    environment.etc."asound.conf".text = ''
      # Hardware dmix - allows multiple apps to share the audio device
      pcm.dmixer {
        type dmix
        ipc_key 1024
        ipc_perm 0666
        slave {
          pcm "hw:0,0"
          period_time 0
          period_size 1024
          buffer_size 4096
          rate 44100
        }
      }

      # Software volume control on top of dmix
      pcm.softvol {
        type softvol
        slave.pcm "dmixer"
        control {
          name "Master"
          card 0
        }
        min_dB -51.0
        max_dB 0.0
      }

      # Default to softvol for volume control (goes through dmix)
      pcm.!default {
        type plug
        slave.pcm "softvol"
      }

      # Default control device
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
      after = [ "network-online.target" "sound.target" ];
      wants = [ "network-online.target" "sound.target" ];
      wantedBy = [ "multi-user.target" ];

      # Add required tools to PATH
      path = with pkgs; [
        alsa-utils      # aplay, amixer (ALSA playback and volume control)
        i2c-tools       # i2cdetect, i2cget (NFC reader)
        libgpiod        # gpioset, gpioget (GPIO control for amplifier)
        mpv             # mpv (audio playback with IPC control)
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
        ReadWritePaths = [ "/tmp" "/run/musicbox" "/var/cache/musicbox" ];
        
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

    # Create directories (config in /run, cache in /var/cache)
    systemd.tmpfiles.rules = [
      "d /run/musicbox 0755 ${cfg.user} ${cfg.group} -"
      "L+ /run/musicbox/player.config.json - - - - ${configFile}"
      "d /var/cache/musicbox 0755 ${cfg.user} ${cfg.group} -"
    ];

    # Open firewall port for HTTP API
    networking.firewall.allowedTCPPorts = [ cfg.httpPort ];
  };
}
