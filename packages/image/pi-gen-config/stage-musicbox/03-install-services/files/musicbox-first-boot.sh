#!/bin/bash
# MusicBox First Boot Setup
# Expands filesystem, waits for network, and prepares for bootstrap
# Note: We intentionally don't use set -e here because this script must always
# complete successfully to create the .first-boot-complete marker and prevent re-runs

LOG_TAG="musicbox-first-boot"
EXPANDED_MARKER="/var/lib/musicbox/.fs-expanded"

log() {
  echo "[$LOG_TAG] $1"
  logger -t "$LOG_TAG" "$1"
}

# Expand root filesystem to fill SD card
expand_filesystem() {
  if [ -f "$EXPANDED_MARKER" ]; then
    log "Filesystem already expanded, skipping"
    return 0
  fi

  log "Checking if filesystem needs expansion..."

  # Get root partition info
  ROOT_PART=$(findmnt -n -o SOURCE /)
  ROOT_DEV=$(lsblk -no PKNAME "$ROOT_PART" 2>/dev/null || echo "")

  if [ -z "$ROOT_DEV" ]; then
    log "Could not determine root device, skipping expansion"
    return 0
  fi

  log "Root partition: $ROOT_PART on /dev/$ROOT_DEV"

  # Get current sizes
  DISK_SIZE=$(blockdev --getsize64 /dev/$ROOT_DEV 2>/dev/null || echo "0")
  PART_SIZE=$(lsblk -bno SIZE "$ROOT_PART" 2>/dev/null || echo "0")

  if [ "$DISK_SIZE" = "0" ] || [ "$PART_SIZE" = "0" ]; then
    log "Could not determine disk/partition sizes, skipping expansion"
    return 0
  fi

  DISK_SIZE_GB=$((DISK_SIZE / 1024 / 1024 / 1024))
  PART_SIZE_GB=$((PART_SIZE / 1024 / 1024 / 1024))

  log "Disk size: ${DISK_SIZE_GB}GB, Partition size: ${PART_SIZE_GB}GB"

  # Check if expansion is needed (partition less than 90% of disk)
  THRESHOLD=$((DISK_SIZE * 90 / 100))
  if [ "$PART_SIZE" -ge "$THRESHOLD" ]; then
    log "Filesystem already uses most of the disk, skipping expansion"
    mkdir -p "$(dirname $EXPANDED_MARKER)"
    touch "$EXPANDED_MARKER"
    return 0
  fi

  log "Expanding filesystem to use full SD card..."

  # Use raspi-config to expand the partition
  if raspi-config --expand-rootfs; then
    log "Partition table updated, resizing filesystem..."

    # Reload partition table
    partprobe /dev/$ROOT_DEV 2>/dev/null || true

    # Resize the filesystem online
    if resize2fs "$ROOT_PART"; then
      log "Filesystem expanded successfully"
      mkdir -p "$(dirname $EXPANDED_MARKER)"
      touch "$EXPANDED_MARKER"

      # Show new size
      NEW_SIZE=$(df -h / | awk 'NR==2 {print $2}')
      log "New root filesystem size: $NEW_SIZE"
    else
      log "Warning: resize2fs failed, may need reboot"
    fi
  else
    log "Warning: raspi-config --expand-rootfs failed"
  fi
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

# Expand filesystem first (before anything else)
expand_filesystem

# Log disk status
log "Filesystem status:"
df -h / | tail -1 | while read line; do log "  $line"; done

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
  log "Network ready, bootstrap service will start automatically"
else
  log "Network not available, bootstrap will retry when network is up"
  log "To configure WiFi manually: sudo nmcli device wifi connect 'SSID' password 'PASSWORD'"
fi

log "First boot setup complete"
# Note: musicbox-bootstrap.service will start automatically after this service completes
# (configured via systemd Requires= and After= dependencies)
