#!/bin/bash
# Build ESP32 firmware and copy to API directory for local testing/Docker builds
#
# Usage:
#   ./scripts/build-firmware.sh [version]
#
# Examples:
#   ./scripts/build-firmware.sh           # Uses "dev" as version
#   ./scripts/build-firmware.sh 1.0.0     # Uses "1.0.0" as version

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

VERSION="${1:-dev}"

echo "Building firmware version: $VERSION"

# Build firmware
cd "$ROOT_DIR/packages/esp32"
FIRMWARE_VERSION="$VERSION" pio run

# Copy to web package directory
mkdir -p "$ROOT_DIR/packages/web/firmware"
cp .pio/build/esp32-s3-devkitc-1/firmware.bin "$ROOT_DIR/packages/web/firmware/"
echo "{\"version\": \"$VERSION\"}" > "$ROOT_DIR/packages/web/firmware/manifest.json"

echo ""
echo "Firmware built successfully!"
echo "  Binary: packages/web/firmware/firmware.bin"
echo "  Version: $VERSION"
echo ""
echo "SHA256: $(shasum -a 256 "$ROOT_DIR/packages/web/firmware/firmware.bin" | cut -d' ' -f1)"
