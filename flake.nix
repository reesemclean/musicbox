{
  description = "MusicBox - NFC-based music player system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # ESP32 Development
            platformio-core

            # YouTube Music Downloads
            yt-dlp
            (python3.withPackages (ps: with ps; [
              ytmusicapi
            ]))

            # MQTT Broker (for local development)
            mosquitto
          ];

          shellHook = ''
            echo "MusicBox Development Environment"
            echo "================================="
            echo ""
            echo "ESP32 Development:"
            echo "  pio run          # Build firmware"
            echo "  pio run -t upload # Upload to device"
            echo "  pio device monitor # Serial monitor"
          '';
        };
      }
    );
}