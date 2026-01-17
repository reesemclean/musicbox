#!/bin/bash -e

# Copy bundled agent (single JS file, no npm install needed)
install -m 755 files/musicbox-agent.js "${ROOTFS_DIR}/opt/musicbox/agent/musicbox-agent.js"

# Set ownership
on_chroot << EOF
chown -R root:root /opt/musicbox/agent
EOF

# Copy config if provided during build, otherwise create default
if [ -f files/config.txt ]; then
  install -m 644 files/config.txt "${ROOTFS_DIR}/boot/firmware/musicbox/config.txt"
else
  # Create default config with placeholder server URL
  cat > "${ROOTFS_DIR}/boot/firmware/musicbox/config.txt" << 'EOF'
# MusicBox Agent Configuration
# Edit this file to set your server URL

SERVER_URL=http://musicbox.local:3000
EOF
fi
