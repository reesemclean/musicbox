#!/bin/bash -e

echo "=== MusicBox 03-install-services starting ==="
echo "Current directory: $(pwd)"
echo "Files in current dir: $(ls -la)"
echo "Files in files/: $(ls -la files/ 2>&1 || echo 'files/ not found')"

# Install systemd services
install -m 644 files/musicbox-bootstrap.service "${ROOTFS_DIR}/etc/systemd/system/"
install -m 755 files/musicbox-first-boot.sh "${ROOTFS_DIR}/opt/musicbox/"
install -m 644 files/musicbox-first-boot.service "${ROOTFS_DIR}/etc/systemd/system/"

# Install embedded WiFi config if present (generated during build)
if [ -f files/wifi-config.txt ]; then
  echo "=== Found wifi-config.txt, installing to ${ROOTFS_DIR}/opt/musicbox/ ==="
  install -m 600 files/wifi-config.txt "${ROOTFS_DIR}/opt/musicbox/wifi-config.txt"
  echo "=== WiFi config installed ==="
else
  echo "=== WARNING: wifi-config.txt NOT FOUND ==="
fi

# Enable services
on_chroot << EOF
systemctl enable musicbox-bootstrap.service
systemctl enable musicbox-first-boot.service
EOF
