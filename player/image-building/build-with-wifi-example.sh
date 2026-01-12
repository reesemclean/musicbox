#!/usr/bin/env bash
# Example: Build MusicBox generic image with WiFi pre-configured
#
# This script shows how to build a generic image with WiFi credentials embedded.
# The resulting image can be flashed to multiple Pis that will all connect to
# the same WiFi network automatically.
#
# SECURITY WARNING: The WiFi password will be embedded in the image!
# Only use this for private deployments where you control all the hardware.

set -e

# Configuration
WIFI_SSID="YourNetworkName"
WIFI_PASSWORD="YourWiFiPassword"

echo "Building MusicBox generic image with WiFi pre-configured..."
echo "  SSID: $WIFI_SSID"
echo ""
echo "⚠️  WARNING: WiFi password will be embedded in the image!"
echo ""

# Build the image
node --experimental-transform-types build-generic-image.ts \
  --wifi-ssid "$WIFI_SSID" \
  --wifi-password "$WIFI_PASSWORD"

echo ""
echo "✓ Done! Image built with WiFi pre-configured."
echo ""
echo "Next steps:"
echo "  1. Flash outputs/musicbox-generic.img to SD cards"
echo "  2. Boot each Pi (they'll connect to WiFi automatically)"
echo "  3. SSH to musicbox.local and run setup wizard"
echo "  4. Enter device-specific configuration (ID, name, secret)"
