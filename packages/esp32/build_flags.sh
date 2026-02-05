#!/bin/bash
# Load .env if present, then emit build flags
test -f .env && . .env

if [ -z "$WIFI_SSID" ] || [ -z "$WIFI_PASS" ]; then
  echo "Error: WIFI_SSID and WIFI_PASS must be set." >&2
  echo "Create packages/esp32/.env from .env.example" >&2
  exit 1
fi

echo "-DFIRMWARE_VERSION='\"${FIRMWARE_VERSION:-dev}\"'"
echo "-DWIFI_SSID='\"${WIFI_SSID}\"'"
echo "-DWIFI_PASS='\"${WIFI_PASS}\"'"
echo "-DMQTT_BROKER_HOST='\"${MQTT_BROKER_HOST:-localhost}\"'"
echo "-DMQTT_BROKER_PORT=${MQTT_BROKER_PORT:-1883}"
echo "-DAPI_HOST='\"${API_HOST:-localhost}\"'"
echo "-DAPI_PORT=${API_PORT:-3000}"
