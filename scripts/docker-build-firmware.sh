#!/usr/bin/env bash
# Build ESP32 firmware inside the Docker builder container.
# Env vars (WIFI_SSID, WIFI_PASS, etc.) come from docker-compose.
# Output: /firmware/firmware.bin + /firmware/manifest.json

set -euo pipefail

if [ -z "${WIFI_SSID:-}" ] || [ -z "${WIFI_PASS:-}" ]; then
  echo "Error: WIFI_SSID and WIFI_PASS must be set via environment variables." >&2
  exit 1
fi

VERSION="${FIRMWARE_VERSION:-dev}"
echo "Building firmware version: $VERSION"

cd /build/packages/esp32

nix develop /build --command pio run

mkdir -p /firmware
cp .pio/build/esp32-s3-devkitc-1/firmware.bin /firmware/
echo "{\"version\": \"$VERSION\"}" > /firmware/manifest.json

echo ""
echo "Firmware built successfully!"
echo "  Version: $VERSION"
echo "  Output:  /firmware/firmware.bin"
