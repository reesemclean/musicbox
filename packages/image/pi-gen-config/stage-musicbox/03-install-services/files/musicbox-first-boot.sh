#!/bin/bash
# MusicBox First Boot Setup
# Configures WiFi from embedded config or boot partition file

# Check for embedded WiFi config first (baked into image during build)
EMBEDDED_WIFI="/opt/musicbox/wifi-config.txt"
# Then check boot partition (for post-flash configuration)
BOOT_WIFI="/boot/firmware/musicbox/wifi.txt"

configure_wifi() {
  local config_file="$1"
  local config_type="$2"
  
  echo "MusicBox: Configuring WiFi from $config_type ($config_file)"
  
  # Source the config file
  source "$config_file"
  
  if [ -n "$SSID" ] && [ -n "$PASSWORD" ]; then
    echo "MusicBox: Setting up WiFi for SSID: $SSID"
    
    # Set WiFi country code (this also unblocks rfkill)
    raspi-config nonint do_wifi_country "${COUNTRY:-US}"
    
    # Explicitly unblock WiFi
    rfkill unblock wifi
    
    # Delete any existing connection with same name
    nmcli connection delete "musicbox-wifi" 2>/dev/null || true
    
    # Create NetworkManager connection
    nmcli connection add \
      type wifi \
      con-name "musicbox-wifi" \
      ifname wlan0 \
      ssid "$SSID" \
      wifi-sec.key-mgmt wpa-psk \
      wifi-sec.psk "$PASSWORD"
    
    # Activate the connection
    echo "MusicBox: Activating WiFi connection..."
    nmcli connection up "musicbox-wifi"
    
    echo "MusicBox: WiFi configured, waiting for connection..."
    sleep 10
    
    # Show IP address
    ip addr show wlan0 | grep "inet " || echo "MusicBox: No IP address yet"
    
    return 0
  else
    echo "MusicBox: WiFi config incomplete (missing SSID or PASSWORD)"
    return 1
  fi
}

# Try embedded config first
if [ -f "$EMBEDDED_WIFI" ]; then
  configure_wifi "$EMBEDDED_WIFI" "embedded"
  # Remove embedded config after use (contains password)
  rm -f "$EMBEDDED_WIFI"
# Then try boot partition config
elif [ -f "$BOOT_WIFI" ]; then
  configure_wifi "$BOOT_WIFI" "boot partition"
  # Rename so we don't run again
  mv "$BOOT_WIFI" "${BOOT_WIFI}.done"
else
  echo "MusicBox: No WiFi config found"
  echo "MusicBox: Connect via Ethernet or add wifi.txt to boot partition"
fi

# Run bootstrap for initial registration
echo "MusicBox: Running bootstrap for initial registration..."
systemctl start musicbox-bootstrap.service
