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
            # Node.js for API and Web
            nodejs_24

            # ESP32 Development
            platformio-core

            # YouTube Music Downloads
            yt-dlp
            (python3.withPackages (ps: with ps; [
              ytmusicapi
            ]))

            # MQTT Broker: Use Homebrew (nixpkgs version has WebSocket bugs)
            # brew install mosquitto
            # /opt/homebrew/sbin/mosquitto -c mosquitto.conf -v
          ];

          shellHook = ''
            echo "MusicBox Development Environment"
            echo "================================="
            echo ""
            echo "Node.js: $(node --version)"
            echo "npm: $(npm --version)"
            echo ""
            echo "Commands:"
            echo "  cd packages/web && npm run dev    # Start web app"
            echo "  cd packages/esp32 && pio run      # Build firmware"
          '';
        };
      }
    );
}