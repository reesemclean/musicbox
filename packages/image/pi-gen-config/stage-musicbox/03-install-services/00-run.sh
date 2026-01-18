#!/bin/bash -e

# Install systemd services
install -m 644 files/musicbox-bootstrap.service "${ROOTFS_DIR}/etc/systemd/system/"
install -m 755 files/musicbox-first-boot.sh "${ROOTFS_DIR}/opt/musicbox/"
install -m 644 files/musicbox-first-boot.service "${ROOTFS_DIR}/etc/systemd/system/"

# Install embedded WiFi config if present (generated during build)
if [ -f files/wifi-config.txt ]; then
  install -m 600 files/wifi-config.txt "${ROOTFS_DIR}/opt/musicbox/wifi-config.txt"
  echo "WiFi config installed"
fi

# Enable services
on_chroot << EOF
systemctl enable musicbox-bootstrap.service
systemctl enable musicbox-first-boot.service
EOF

# Disable unused services for faster boot
on_chroot << EOF
# Bluetooth (not used)
systemctl disable bluetooth.service || true
systemctl disable hciuart.service || true

# Keyboard hotkey daemon (headless device)
systemctl disable triggerhappy.service || true
systemctl disable triggerhappy.socket || true

# Auto-updates (we manage updates via Ansible)
systemctl disable apt-daily.service || true
systemctl disable apt-daily-upgrade.service || true
systemctl disable apt-daily.timer || true
systemctl disable apt-daily-upgrade.timer || true

# Man page indexing
systemctl disable man-db.timer || true

# Filesystem scrubbing
systemctl disable e2scrub_all.timer || true
systemctl disable e2scrub_reap.service || true

# ModemManager (no modems)
systemctl disable ModemManager.service || true

# EEPROM update check
systemctl disable rpi-eeprom-update.service || true
EOF
