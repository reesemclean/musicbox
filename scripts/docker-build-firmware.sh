#!/usr/bin/env bash
# Build ESP32 firmware inside the Docker builder container.
# Env vars (WIFI_SSID, WIFI_PASS, etc.) come from docker-compose.
# Output: /firmware/firmware.bin + /firmware/manifest.json

set -euo pipefail

echo "=== Firmware Builder ==="
echo "WIFI_SSID=${WIFI_SSID:-<not set>}"
echo "WIFI_PASS=${WIFI_PASS:+<set>}${WIFI_PASS:-<not set>}"
echo "API_BASE_URL=${API_BASE_URL:-<not set>}"
echo "MQTT_BROKER_HOST=${MQTT_BROKER_HOST:-<not set>}"

if [ -z "${WIFI_SSID:-}" ] || [ -z "${WIFI_PASS:-}" ]; then
  echo "Error: WIFI_SSID and WIFI_PASS must be set via environment variables." >&2
  exit 1
fi

VERSION="${FIRMWARE_VERSION:-dev}"
echo "Building firmware version: $VERSION"

cd /build/packages/esp32

pio run

mkdir -p /firmware
cp .pio/build/esp32-s3-devkitc-1/firmware.bin /firmware/
echo "{\"version\": \"$VERSION\"}" > /firmware/manifest.json

echo ""
echo "Firmware built successfully!"
echo "  Version: $VERSION"
echo "  Output:  /firmware/firmware.bin"
