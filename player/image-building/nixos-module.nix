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

    # Enable I2S audio hardware for MAX98357A amplifier
    # Uses device tree overlay to configure GPIO pins 18, 19, 21 for I2S
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

    # PipeWire audio server (modern replacement for PulseAudio/JACK)
    security.rtkit.enable = true;
    services.pipewire = {
      enable = true;
      alsa.enable = true;
      alsa.support32Bit = false;  # Pi Zero 2 W is 64-bit
      pulse.enable = true;  # PulseAudio compatibility (for pactl)
    };

    # ALSA configuration for MAX98357A I2S card
    # The I2S card will be card 0 (with onboard audio disabled)
    environment.etc."asound.conf".text = ''
      # Use card 0 as default (I2S MAX98357A)
      defaults.pcm.card 0
      defaults.ctl.card 0

      # Default PCM device
      pcm.!default {
        type plug
        slave.pcm "hw:0,0"
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
