#!/bin/bash
# Emit build flags — only FIRMWARE_VERSION remains compile-time.
# All other config (WiFi, MQTT, API URL) is provisioned at runtime via NVS.
test -f .env && . .env

echo "-DFIRMWARE_VERSION='\"${FIRMWARE_VERSION:-dev}\"'"
