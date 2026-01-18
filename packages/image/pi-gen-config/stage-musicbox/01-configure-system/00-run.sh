#!/bin/bash -e

# Copy boot config
install -m 644 files/config.txt "${ROOTFS_DIR}/boot/firmware/config.txt"

# Ensure cmdline.txt has the 'resize' parameter for automatic filesystem expansion
# The rpi-resize service reads this on first boot
if [ -f "${ROOTFS_DIR}/boot/firmware/cmdline.txt" ]; then
  if ! grep -q 'resize' "${ROOTFS_DIR}/boot/firmware/cmdline.txt"; then
    sed -i 's/$/ resize/' "${ROOTFS_DIR}/boot/firmware/cmdline.txt"
    echo "Added 'resize' parameter to cmdline.txt"
  fi
else
  echo "Warning: cmdline.txt not found, will be created by pi-gen"
fi

# Enable the rpi-resize service for automatic filesystem expansion on first boot
on_chroot << EOF
systemctl enable rpi-resize || true
EOF

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
install -d -m 755 "${ROOTFS_DIR}/boot/firmware/musicbox"

# Set ownership
on_chroot << EOF
chown -R musicbox:musicbox /opt/musicbox
chown -R musicbox:musicbox /var/cache/musicbox
EOF

# Enable I2C
on_chroot << EOF
raspi-config nonint do_i2c 0
EOF

# Install Node.js 22 LTS
on_chroot << EOF
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
EOF

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
