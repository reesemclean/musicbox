#!/bin/bash
# MusicBox First Boot Setup
# Configures WiFi from embedded config or boot partition file

WPA_CONF="/etc/wpa_supplicant/wpa_supplicant.conf"

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
    
    # Create wpa_supplicant config
    cat > "$WPA_CONF" << EOF
country=${COUNTRY:-US}
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
  ssid="$SSID"
  psk="$PASSWORD"
}
EOF
    
    # Set permissions
    chmod 600 "$WPA_CONF"
    
    # Restart networking
    systemctl restart wpa_supplicant
    rfkill unblock wifi
    
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
