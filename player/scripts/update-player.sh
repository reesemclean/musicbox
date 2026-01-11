#!/usr/bin/env bash
# MusicBox Player - Update Script
#
# Run this on your Raspberry Pi to update the player without reflashing SD card
#
# Usage:
#   sudo ./update-player.sh
#   sudo ./update-player.sh --rollback  # Revert to previous version

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

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║           MusicBox Player - Update Without Reflash            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Handle rollback
if [ "$1" = "--rollback" ]; then
    log_warning "Rolling back to previous NixOS generation..."
    echo ""

    nixos-rebuild switch --rollback

    log_success "Rollback complete!"
    log_info "Player service restarted with previous version"
    echo ""
    echo "Check logs: journalctl -u musicbox-player -f"
    exit 0
fi

# Show current version
log_info "Current system generation:"
nixos-rebuild list-generations | tail -3
echo ""

# Update NixOS configuration
log_info "Fetching latest code from Git..."
log_warning "This will rebuild the player with latest changes from your repo"
echo ""

# Show what will happen
log_info "This will:"
echo "  1. Fetch latest code from Git"
echo "  2. Rebuild player package"
echo "  3. Restart musicbox-player service"
echo "  4. Keep old version for instant rollback"
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Update cancelled"
    exit 0
fi

echo ""
log_info "Rebuilding system..."
echo ""

# Run nixos-rebuild switch
# This will:
# - Fetch latest from git (builtins.fetchGit in configuration.nix)
# - Build new player package
# - Switch to new configuration
# - Restart services
if nixos-rebuild switch; then
    echo ""
    log_success "Update complete!"
    echo ""
    log_info "New system generation:"
    nixos-rebuild list-generations | tail -1
    echo ""
    log_info "Checking player service status..."

    # Wait a moment for service to start
    sleep 2

    if systemctl is-active --quiet musicbox-player; then
        log_success "Player service is running"
        echo ""
        echo "Recent logs:"
        journalctl -u musicbox-player -n 10 --no-pager | sed 's/^/  /'
    else
        log_error "Player service failed to start!"
        echo ""
        log_warning "Check logs: journalctl -u musicbox-player -f"
        log_warning "Rollback: sudo $0 --rollback"
    fi

    echo ""
    log_info "To rollback if something is wrong:"
    echo "  sudo $0 --rollback"
    echo ""
    log_info "To see live logs:"
    echo "  sudo journalctl -u musicbox-player -f"
else
    echo ""
    log_error "Update failed!"
    echo ""
    log_info "Your system is unchanged (still running previous version)"
    log_info "Check the error messages above for details"
    exit 1
fi
