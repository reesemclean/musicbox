# NixOS Image Builder
# Provides a Linux environment for building NixOS images from macOS/Windows

FROM nixos/nix:latest

# Enable flakes and nix-command
RUN echo "experimental-features = nix-command flakes" >> /etc/nix/nix.conf

# Install nixos-generators and zstd for decompression
RUN nix-env -iA nixpkgs.nixos-generators nixpkgs.zstd

# Set working directory
WORKDIR /build

# Default command
CMD ["/bin/bash"]
