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
        
        # Common dependencies for both server and player
        commonDeps = with pkgs; [
          nodejs_22
          nodePackages.typescript
          nodePackages.typescript-language-server
        ];
        
        # Python with ytmusicapi
        pythonWithPackages = pkgs.python311.withPackages (ps: with ps; [
          ytmusicapi
        ]);

        # Server-specific dependencies
        serverDeps = with pkgs; [
          pythonWithPackages
          yt-dlp
          ffmpeg
          sqlite
        ];
        
        # Player-specific dependencies
        playerDeps = with pkgs; [
          mpv       # Audio playback with IPC control
        ];
        
        # Player package
        musicbox-player = pkgs.callPackage ./player/package.nix {};
        
      in {
        # Packages
        packages = {
          player = musicbox-player;
          default = musicbox-player;
        };
        
        # Development shells
        devShells = {
          # Default: Everything for full-stack development
          default = pkgs.mkShell {
            buildInputs = commonDeps ++ serverDeps ++ playerDeps;
            
            shellHook = ''
              echo "🎵 MusicBox Development Environment"
              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
              echo "Node: $(node --version)"
              echo "Python: $(python3 --version)"
              echo ""
              echo "Available commands:"
              echo "  cd server && npm run dev    # Start server"
              echo "  cd player && npm run dev    # Start player"
              echo ""
              echo "Other shells:"
              echo "  nix develop .#server        # Server only"
              echo "  nix develop .#player        # Player only"
            '';
          };
          
          # Server-only shell
          server = pkgs.mkShell {
            buildInputs = commonDeps ++ serverDeps;
            
            shellHook = ''
              echo "🎵 MusicBox Server Environment"
              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
              echo "Node: $(node --version)"
              echo "Python: $(python3 --version)"
              echo ""
              echo "cd server && npm run dev"
            '';
          };
          
          # Player-only shell
          player = pkgs.mkShell {
            buildInputs = commonDeps ++ playerDeps;
            
            shellHook = ''
              echo "🎵 MusicBox Player Environment"
              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
              echo "Node: $(node --version)"
              echo ""
              echo "cd player && npm run dev"
            '';
          };
        };
      }
    ) // {
      # NixOS module (not system-specific)
      nixosModules.musicbox-player = import ./player/image-building/nixos-module.nix;

      # Note: SD card images are built via player/image-building/build-image.ts
      # which uses nixos-generate in Docker for cross-compilation
    };
}
