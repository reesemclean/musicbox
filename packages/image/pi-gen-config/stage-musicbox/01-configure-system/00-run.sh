#!/bin/bash -e

# Copy boot config
install -m 644 files/config.txt "${ROOTFS_DIR}/boot/firmware/config.txt"

# Copy ALSA config
install -m 644 files/asound.conf "${ROOTFS_DIR}/etc/asound.conf"

# Add musicbox user to required groups (user is created by pi-gen via FIRST_USER_NAME)
on_chroot << EOF
usermod -a -G audio,i2c,gpio musicbox || true
EOF

# Create directories
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox"
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox/agent"
install -d -m 755 "${ROOTFS_DIR}/opt/musicbox/player"
install -d -m 755 "${ROOTFS_DIR}/var/cache/musicbox"
install -d -m 755 "${ROOTFS_DIR}/var/lib/musicbox"
install -d -m 755 "${ROOTFS_DIR}/boot/firmware/musicbox"

# Set ownership
on_chroot << EOF
chown -R musicbox:musicbox /opt/musicbox
chown -R musicbox:musicbox /var/cache/musicbox
chown -R musicbox:musicbox /var/lib/musicbox
EOF

# Enable I2C
on_chroot << EOF
raspi-config nonint do_i2c 0
EOF

# Note: Node.js and build tools removed - Go player is a static binary

# Setup SSH authorized_keys for the musicbox user
install -d -m 700 "${ROOTFS_DIR}/home/musicbox/.ssh"
if [ -s files/authorized_keys ]; then
  # Only install if file has content (not just comments)
  grep -v '^#' files/authorized_keys | grep -v '^$' > /tmp/keys_only || true
  if [ -s /tmp/keys_only ]; then
    install -m 600 files/authorized_keys "${ROOTFS_DIR}/home/musicbox/.ssh/authorized_keys"
  fi
  rm -f /tmp/keys_only
fi
on_chroot << EOF
chown -R musicbox:musicbox /home/musicbox/.ssh
EOF

# Configure passwordless sudo for musicbox user (required for Ansible deployments)
echo "musicbox ALL=(ALL) NOPASSWD: ALL" > "${ROOTFS_DIR}/etc/sudoers.d/010_musicbox-nopasswd"
chmod 440 "${ROOTFS_DIR}/etc/sudoers.d/010_musicbox-nopasswd"

# Disable WiFi power management (causes connection drops during Ansible)
install -d -m 755 "${ROOTFS_DIR}/etc/NetworkManager/conf.d"
cat > "${ROOTFS_DIR}/etc/NetworkManager/conf.d/wifi-powersave-off.conf" << 'EOF'
[connection]
wifi.powersave = 2
EOF
