#!/usr/bin/env bash
# MusicBox Player - First-Boot Setup Wizard
#
# This script configures a generic MusicBox image for a specific device
#
# Usage:
#   /root/setup-musicbox.sh
#   /root/setup-musicbox.sh --from-file config.json

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

prompt() {
    local prompt_text="$1"
    local default_value="$2"
    local result

    if [ -n "$default_value" ]; then
        read -p "$(echo -e ${CYAN}${prompt_text}${NC} [${default_value}]: )" result
        result="${result:-$default_value}"
    else
        read -p "$(echo -e ${CYAN}${prompt_text}${NC}: )" result
    fi

    echo "$result"
}

prompt_password() {
    local prompt_text="$1"
    local result

    read -s -p "$(echo -e ${CYAN}${prompt_text}${NC}: )" result
    echo ""
    echo "$result"
}

confirm() {
    local prompt_text="$1"
    local response

    read -p "$(echo -e ${CYAN}${prompt_text}${NC} (y/N): )" -n 1 -r response
    echo ""
    [[ $response =~ ^[Yy]$ ]]
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root: sudo $0"
    exit 1
fi

# Banner
clear
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         MusicBox Player - First-Boot Setup Wizard             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check for config file mode
CONFIG_FILE=""
if [ "$1" = "--from-file" ] && [ -n "$2" ]; then
    CONFIG_FILE="$2"
    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "Config file not found: $CONFIG_FILE"
        exit 1
    fi
    log_success "Loading configuration from: $CONFIG_FILE"
    echo ""
fi

# WiFi Configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 1: WiFi Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if WiFi is already configured (secrets.nix exists)
WIFI_PRECONFIGURED=false
if [ -f /etc/nixos/secrets.nix ] && grep -q "wifi" /etc/nixos/secrets.nix 2>/dev/null; then
    WIFI_PRECONFIGURED=true
    log_success "WiFi already configured in the image"
    # Extract WiFi SSID for later use
    WIFI_SSID=$(grep -A2 "wifi" /etc/nixos/secrets.nix | grep "ssid" | cut -d'"' -f2)
    WIFI_PASSWORD=""  # Don't extract password for security
    log_info "Keeping existing WiFi configuration: $WIFI_SSID"
elif [ -n "$CONFIG_FILE" ]; then
    WIFI_SSID=$(cat "$CONFIG_FILE" | grep -o '"wifiSsid":"[^"]*"' | cut -d'"' -f4)
    WIFI_PASSWORD=$(cat "$CONFIG_FILE" | grep -o '"wifiPassword":"[^"]*"' | cut -d'"' -f4)
    log_success "WiFi SSID: $WIFI_SSID"
else
    WIFI_SSID=$(prompt "WiFi SSID")
    WIFI_PASSWORD=$(prompt_password "WiFi Password")
fi

if [ -z "$WIFI_SSID" ] && [ "$WIFI_PRECONFIGURED" = false ]; then
    log_error "WiFi SSID cannot be empty"
    exit 1
fi

echo ""

# Device Configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 2: Device Registration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Get these values from your MusicBox server admin UI"
echo ""

if [ -n "$CONFIG_FILE" ]; then
    DEVICE_ID=$(cat "$CONFIG_FILE" | grep -o '"deviceId":[0-9]*' | cut -d':' -f2)
    DEVICE_NAME=$(cat "$CONFIG_FILE" | grep -o '"deviceName":"[^"]*"' | cut -d'"' -f4)
    DEVICE_SECRET=$(cat "$CONFIG_FILE" | grep -o '"deviceSecret":"[^"]*"' | cut -d'"' -f4)
    SERVER_URL=$(cat "$CONFIG_FILE" | grep -o '"serverUrl":"[^"]*"' | cut -d'"' -f4)
    log_success "Device ID: $DEVICE_ID"
    log_success "Device Name: $DEVICE_NAME"
    log_success "Server URL: $SERVER_URL"
else
    DEVICE_ID=$(prompt "Device ID (from server)")
    DEVICE_NAME=$(prompt "Device Name (e.g., living-room)")
    DEVICE_SECRET=$(prompt "Device Secret (UUID from server)")
    SERVER_URL=$(prompt "Server URL" "http://192.168.1.100:3000")
fi

if [ -z "$DEVICE_ID" ] || [ -z "$DEVICE_NAME" ] || [ -z "$DEVICE_SECRET" ] || [ -z "$SERVER_URL" ]; then
    log_error "All device fields are required"
    exit 1
fi

echo ""

# Git Updates Configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Step 3: Update Strategy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Git-based updates allow you to update the player without reflashing:"
echo "  1. Make changes and push to Git"
echo "  2. SSH to Pi and run: sudo nixos-rebuild switch"
echo "  3. Player updates automatically!"
echo ""

if [ -n "$CONFIG_FILE" ]; then
    ENABLE_GIT_UPDATES=$(cat "$CONFIG_FILE" | grep -o '"enableGitUpdates":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    GIT_REPO=$(cat "$CONFIG_FILE" | grep -o '"gitRepo":"[^"]*"' | cut -d'"' -f4)
    GIT_REPO="${GIT_REPO:-reesemclean/musicbox}"
    if [ "$ENABLE_GIT_UPDATES" = "true" ]; then
        log_success "Git updates: Enabled ($GIT_REPO)"
    else
        log_info "Git updates: Disabled (using local files)"
    fi
else
    if confirm "Enable Git-based updates?"; then
        ENABLE_GIT_UPDATES="true"
        GIT_REPO=$(prompt "Git repository" "reesemclean/musicbox")
    else
        ENABLE_GIT_UPDATES="false"
        log_info "Using local files (updates require reflashing)"
    fi
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Configuration Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "WiFi:"
echo "  SSID: $WIFI_SSID"
echo ""
echo "Device:"
echo "  ID: $DEVICE_ID"
echo "  Name: $DEVICE_NAME"
echo "  Server: $SERVER_URL"
echo ""
echo "Updates:"
if [ "$ENABLE_GIT_UPDATES" = "true" ]; then
    echo "  Mode: Git (from https://github.com/$GIT_REPO)"
else
    echo "  Mode: Local files (reflash to update)"
fi
echo ""

if [ -z "$CONFIG_FILE" ]; then
    if ! confirm "Apply this configuration?"; then
        log_warning "Setup cancelled"
        exit 0
    fi
    echo ""
fi

# Backup existing configuration
log_info "Backing up existing configuration..."
cd /etc/nixos
if [ -f configuration.nix ]; then
    cp configuration.nix configuration.nix.backup-$(date +%Y%m%d-%H%M%S)
fi

# Generate secrets.nix
log_info "Writing secrets.nix..."

if [ "$WIFI_PRECONFIGURED" = true ]; then
    # WiFi already in image - preserve existing secrets.nix and add device info
    log_info "Preserving pre-configured WiFi credentials"
    # Backup original secrets.nix FIRST (before overwriting)
    if [ ! -f secrets.nix.orig ]; then
        cp secrets.nix secrets.nix.orig
    fi
    # Read existing secrets and add device info
    cat > secrets.nix <<EOF
# MusicBox Secrets
# WiFi: Pre-configured at build time
# Device: Configured by setup wizard

{
  wifi = (import ./secrets.nix.orig).wifi;

  server = {
    url = "${SERVER_URL}";
  };

  deviceSecret = "${DEVICE_SECRET}";
}
EOF
else
    # WiFi not pre-configured - create new secrets.nix
    cat > secrets.nix <<EOF
# MusicBox Secrets
# Generated by setup wizard

{
  wifi = {
    ssid = "${WIFI_SSID}";
    password = "${WIFI_PASSWORD}";
  };

  server = {
    url = "${SERVER_URL}";
  };

  deviceSecret = "${DEVICE_SECRET}";
}
EOF
fi

# Generate configuration.nix
log_info "Writing configuration.nix..."

if [ "$ENABLE_GIT_UPDATES" = "true" ]; then
    # Git mode configuration
    cat > configuration.nix <<EOF
# MusicBox Player Configuration for: ${DEVICE_NAME}
# Mode: GIT (updates from GitHub)
# Generated by setup wizard

{ config, pkgs, ... }:

let
  secrets = import ./secrets.nix;

  # Fetch MusicBox code from Git
  musicbox = builtins.fetchGit {
    url = "https://github.com/${GIT_REPO}";
    ref = "main";
  };
in
{
  imports = [
    "\${musicbox}/player/image-building/nixos-module.nix"
  ];

  # Boot configuration
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;
  boot.kernelModules = [ "i2c-dev" "i2c-bcm2835" ];

  # Flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Network
  networking.hostName = "musicbox-${DEVICE_NAME}";
  networking.wireless = {
    enable = true;
    networks.\${secrets.wifi.ssid}.psk = secrets.wifi.password;
  };

  # mDNS
  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
      hinfo = true;
      userServices = true;
      workstation = true;
    };
  };

  # SSH
  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "prohibit-password";
  };

  # Firewall
  networking.firewall.allowedTCPPorts = [ 22 ];
  networking.firewall.allowedUDPPorts = [ 5353 ];

  # MusicBox Player
  services.musicbox-player = {
    enable = true;
    deviceId = ${DEVICE_ID};
    deviceName = "${DEVICE_NAME}";
    deviceSecret = secrets.deviceSecret;
    serverUrl = secrets.server.url;
    httpPort = 8080;
  };

  # System packages
  environment.systemPackages = with pkgs; [
    vim git htop i2c-tools alsa-utils pulseaudio
  ];

  system.stateVersion = "24.05";
}
EOF
else
    # Local mode configuration (using /etc/nixos/nixos-module.nix)
    # First, copy the module to /etc/nixos if not already there
    if [ ! -f /etc/nixos/nixos-module.nix ]; then
        log_info "Copying nixos-module.nix to /etc/nixos..."
        # Assuming it's in the root's home or we fetch it
        # For now, we'll create a minimal inline version
    fi

    cat > configuration.nix <<EOF
# MusicBox Player Configuration for: ${DEVICE_NAME}
# Mode: LOCAL (using embedded files)
# Generated by setup wizard

{ config, pkgs, ... }:

let
  secrets = import ./secrets.nix;
in
{
  imports = [
    # Using local module (was in the generic image)
    # This file should exist at /etc/nixos/nixos-module.nix
    ./nixos-module.nix
  ];

  # Boot configuration
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;
  boot.kernelModules = [ "i2c-dev" "i2c-bcm2835" ];

  # Flakes
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # Network
  networking.hostName = "musicbox-${DEVICE_NAME}";
  networking.wireless = {
    enable = true;
    networks.\${secrets.wifi.ssid}.psk = secrets.wifi.password;
  };

  # mDNS
  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
      hinfo = true;
      userServices = true;
      workstation = true;
    };
  };

  # SSH
  services.openssh = {
    enable = true;
    settings.PermitRootLogin = "prohibit-password";
  };

  # Firewall
  networking.firewall.allowedTCPPorts = [ 22 ];
  networking.firewall.allowedUDPPorts = [ 5353 ];

  # MusicBox Player
  services.musicbox-player = {
    enable = true;
    deviceId = ${DEVICE_ID};
    deviceName = "${DEVICE_NAME}";
    deviceSecret = secrets.deviceSecret;
    serverUrl = secrets.server.url;
    httpPort = 8080;
  };

  # System packages
  environment.systemPackages = with pkgs; [
    vim git htop i2c-tools alsa-utils pulseaudio
  ];

  system.stateVersion = "24.05";
}
EOF
fi

log_success "Configuration files written"

echo ""
log_info "Testing configuration..."
if ! nixos-rebuild dry-build 2>&1 | head -20; then
    echo ""
    log_error "Configuration test failed!"
    log_warning "Restoring backup..."
    if [ -f configuration.nix.backup-* ]; then
        mv configuration.nix.backup-* configuration.nix 2>/dev/null || true
    fi
    exit 1
fi

echo ""
log_info "Applying configuration..."
log_warning "This will take a few minutes..."
echo ""

if nixos-rebuild switch; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                   Setup Complete! 🎉                           ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    log_success "MusicBox player configured and started!"
    echo ""
    echo "Device Information:"
    echo "  Name: musicbox-${DEVICE_NAME}"
    echo "  Hostname: musicbox-${DEVICE_NAME}.local"
    echo "  WiFi: Connected to $WIFI_SSID"
    echo ""
    echo "Next Steps:"
    echo "  1. The Pi will reboot in 10 seconds"
    echo "  2. After reboot, the player will auto-start"
    echo "  3. Check logs: ssh root@musicbox-${DEVICE_NAME}.local"
    echo "     sudo journalctl -u musicbox-player -f"
    echo ""
    if [ "$ENABLE_GIT_UPDATES" = "true" ]; then
        echo "Future Updates:"
        echo "  1. Push changes to GitHub"
        echo "  2. SSH to Pi: ssh root@musicbox-${DEVICE_NAME}.local"
        echo "  3. Update: sudo nixos-rebuild switch"
        echo ""
    fi

    log_info "Rebooting in 10 seconds..."
    sleep 10
    reboot
else
    echo ""
    log_error "Failed to apply configuration!"
    log_warning "Restoring backup..."
    if [ -f configuration.nix.backup-* ]; then
        mv configuration.nix.backup-* configuration.nix 2>/dev/null || true
    fi
    nixos-rebuild switch 2>&1 || true
    exit 1
fi
