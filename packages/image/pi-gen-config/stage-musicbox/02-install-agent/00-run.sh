#!/bin/bash -e

# Extract pre-built agent
tar -xzf files/agent.tar.gz -C "${ROOTFS_DIR}/opt/musicbox/agent/"

# Install agent dependencies
on_chroot << EOF
cd /opt/musicbox/agent && npm ci --omit=dev
EOF

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
