#!/bin/bash -e

# Install systemd services
install -m 644 files/musicbox-agent.service "${ROOTFS_DIR}/etc/systemd/system/"
install -m 644 files/musicbox-agent.timer "${ROOTFS_DIR}/etc/systemd/system/"
install -m 644 files/musicbox-player.service "${ROOTFS_DIR}/etc/systemd/system/"
install -m 755 files/musicbox-first-boot.sh "${ROOTFS_DIR}/opt/musicbox/"
install -m 644 files/musicbox-first-boot.service "${ROOTFS_DIR}/etc/systemd/system/"

# Install embedded WiFi config if present (generated during build)
if [ -f files/wifi-config.txt ]; then
  install -m 600 files/wifi-config.txt "${ROOTFS_DIR}/opt/musicbox/wifi-config.txt"
fi

# Enable services
on_chroot << EOF
systemctl enable musicbox-agent.timer
systemctl enable musicbox-first-boot.service
EOF
