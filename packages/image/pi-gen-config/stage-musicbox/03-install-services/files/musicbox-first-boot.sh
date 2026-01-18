#!/bin/bash
# MusicBox First Boot Setup
# Waits for network and triggers initial registration with the server

set -e

LOG_TAG="musicbox-first-boot"

log() {
  echo "[$LOG_TAG] $1"
  logger -t "$LOG_TAG" "$1"
}

# Wait for network to be available
wait_for_network() {
  log "Waiting for network connection..."
  local max_attempts=30
  local attempt=0
  
  while [ $attempt -lt $max_attempts ]; do
    if nmcli -t -f STATE general | grep -q "connected"; then
      log "Network connected"
      # Get IP address
      local ip=$(ip -4 addr show wlan0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "")
      if [ -n "$ip" ]; then
        log "WiFi IP address: $ip"
        return 0
      fi
      # Try eth0 as fallback
      ip=$(ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || echo "")
      if [ -n "$ip" ]; then
        log "Ethernet IP address: $ip"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  
  log "Warning: Network not available after $max_attempts attempts"
  return 1
}

# Main
log "Starting MusicBox first boot setup"

# Show network status for debugging
log "Network status:"
nmcli device status 2>&1 | while read line; do log "  $line"; done

# Show rfkill status
log "rfkill status:"
rfkill list 2>&1 | while read line; do log "  $line"; done

# Show regulatory domain
log "Regulatory domain:"
iw reg get 2>&1 | head -3 | while read line; do log "  $line"; done

# Wait for network
if wait_for_network; then
  log "Network ready, starting bootstrap service"
  systemctl start musicbox-bootstrap.service || log "Bootstrap service failed"
else
  log "Network not available, bootstrap will retry later"
  log "To configure WiFi manually: sudo nmcli device wifi connect 'SSID' password 'PASSWORD'"
fi

log "First boot setup complete"
systemctl start musicbox-bootstrap.service
