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
        
      in {
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
              echo "Commands:"
              echo "  npm run dev:server    # Start server"
              echo "  npm run dev:player    # Start player"
            '';
          };
        };
      }
    );
}
