#!/bin/bash -e

# Create MusicBox directories
mkdir -p "${ROOTFS_DIR}/opt/musicbox"
mkdir -p "${ROOTFS_DIR}/boot/firmware/musicbox"

# Copy bootstrap script
install -m 755 files/musicbox-bootstrap.sh "${ROOTFS_DIR}/opt/musicbox/musicbox-bootstrap.sh"

# Copy config if provided during build, otherwise create default
if [ -f files/config.txt ]; then
  install -m 644 files/config.txt "${ROOTFS_DIR}/boot/firmware/musicbox/config.txt"
else
  # Create default config with placeholder server URL
  cat > "${ROOTFS_DIR}/boot/firmware/musicbox/config.txt" << 'EOF'
# MusicBox Configuration
# Edit this file to set your server URL

SERVER_URL=http://musicbox.local:3000
EOF
fi
