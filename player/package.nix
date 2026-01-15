{ pkgs ? import <nixpkgs> {} }:

# MusicBox Player - Nix Package
#
# This packages the pre-built player bundle for deployment.
#
# Workflow:
#   1. Build bundle locally: cd player && npm run build:bundle
#   2. Commit dist/ to git: git add player/dist && git commit
#   3. Package with Nix: nix build .#player
#   4. Deploy to NixOS
#
# Why commit dist/?
#   - Simple: No npm/hash management in Nix
#   - Fast: Nix just copies files (no building)
#   - Reliable: What you test locally is what deploys
#   - Small: Bundle is ~24KB

pkgs.stdenv.mkDerivation rec {
  pname = "musicbox-player";
  version = "0.1.0";

  # Just the player directory
  src = ./.;

  # No build phase - we package the pre-built bundle
  dontBuild = true;

  # Runtime dependencies
  buildInputs = [
    pkgs.nodejs_22  # Node.js runtime
    pkgs.mpv        # mpv for audio playback with IPC control
  ];

  installPhase = ''
    # Verify bundle exists
    if [ ! -f dist/musicbox-player.js ]; then
      echo "ERROR: dist/musicbox-player.js not found!"
      echo "Build it first: cd player && npm run build:bundle"
      exit 1
    fi

    # Create output directories
    mkdir -p $out/bin $out/lib/musicbox-player

    # Copy the pre-built bundle
    cp dist/musicbox-player.js $out/lib/musicbox-player/

    # Copy sourcemap if it exists (for debugging)
    if [ -f dist/musicbox-player.js.map ]; then
      cp dist/musicbox-player.js.map $out/lib/musicbox-player/
    fi

    # Create executable wrapper script
    cat > $out/bin/musicbox-player <<EOF
#!/bin/sh
# MusicBox Player - Wrapper Script
# Runs the bundled player with Node.js
exec ${pkgs.nodejs_22}/bin/node $out/lib/musicbox-player/musicbox-player.js "\$@"
EOF

    chmod +x $out/bin/musicbox-player
  '';

  meta = with pkgs.lib; {
    description = "MusicBox Player - NFC-based music player for Raspberry Pi";
    homepage = "https://github.com/reesemclean/musicbox";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
