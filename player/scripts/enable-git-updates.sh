#!/usr/bin/env bash
# MusicBox Player - Enable Git-Based Updates
#
# Run this ONCE after initial SD card deployment to enable updates via Git
# This allows you to update the player without reflashing the SD card
#
# Usage:
#   sudo ./enable-git-updates.sh [git-repo]
#   sudo ./enable-git-updates.sh reesemclean/musicbox

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root: sudo $0"
    exit 1
fi

GIT_REPO="${1:-reesemclean/musicbox}"
GIT_REF="${2:-main}"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        MusicBox Player - Enable Git-Based Updates             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

log_info "This will configure your Pi to fetch updates from Git"
echo "  Repository: https://github.com/$GIT_REPO"
echo "  Branch: $GIT_REF"
echo ""
log_warning "This is a ONE-TIME setup after initial SD card deployment"
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Setup cancelled"
    exit 0
fi

echo ""

# Check if configuration.nix exists
CONFIG_FILE="/etc/nixos/configuration.nix"
if [ ! -f "$CONFIG_FILE" ]; then
    log_error "Configuration file not found: $CONFIG_FILE"
    exit 1
fi

log_info "Backing up configuration..."
cp "$CONFIG_FILE" "${CONFIG_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
log_success "Backup created"

log_info "Updating configuration to fetch from Git..."

# Create a temporary file with the updated configuration
cat > /tmp/config.nix.new <<EOF
# MusicBox Player Configuration
# Auto-configured for Git-based updates

{ config, pkgs, ... }:

let
  secrets = import ./secrets.nix;

  # Fetch MusicBox code from Git (allows updates without reflashing!)
  musicbox = builtins.fetchGit {
    url = "https://github.com/$GIT_REPO";
    ref = "$GIT_REF";
    # Uncomment to pin to specific commit (more stable):
    # rev = "abc123...";
  };
in
{
  imports = [
    # Fetch nixos-module.nix from Git
    "\${musicbox}/player/image-building/nixos-module.nix"
  ];
EOF

# Copy the rest of the configuration (everything after "imports = [")
# Skip the original imports section and add our content
sed -n '/# Boot configuration for Raspberry Pi/,$p' "$CONFIG_FILE" >> /tmp/config.nix.new

# Replace the configuration
mv /tmp/config.nix.new "$CONFIG_FILE"

log_success "Configuration updated"

echo ""
log_info "Testing configuration..."

# Test that the configuration is valid
if nixos-rebuild dry-build 2>&1 | grep -q "error:"; then
    log_error "Configuration test failed!"
    log_warning "Restoring backup..."
    mv "${CONFIG_FILE}.backup-"* "$CONFIG_FILE"
    exit 1
fi

log_success "Configuration is valid"

echo ""
log_info "Applying configuration..."

# Apply the configuration
if nixos-rebuild switch; then
    echo ""
    log_success "Git-based updates enabled!"
    echo ""
    log_info "Future updates:"
    echo "  1. Make changes on your laptop"
    echo "  2. Build bundle: npm run build:bundle"
    echo "  3. Commit and push: git commit && git push"
    echo "  4. SSH to Pi: ssh root@\$(hostname)"
    echo "  5. Update: nixos-rebuild switch"
    echo ""
    log_success "Setup complete! You can now update without reflashing."
else
    log_error "Failed to apply configuration"
    log_warning "Restoring backup..."
    mv "${CONFIG_FILE}.backup-"* "$CONFIG_FILE"
    nixos-rebuild switch
    exit 1
fi
