# MusicBox Development

## Quick Start

Run these in separate terminal windows:

### 1. MQTT Broker (Mosquitto)
```bash
mosquitto -c mosquitto/mosquitto.conf
```

### 2. API Server
```bash
cd packages/api && npm run dev
```

### 3. Web Frontend
```bash
cd packages/web && npm run dev
```

### 4. ESP32
```bash
cd packages/esp32

# Build, upload, and monitor
pio run -t upload && pio device monitor

# Or separately:
pio run              # Build only
pio run -t upload    # Upload only
pio device monitor   # Monitor only
```

## Testing the Full Flow

1. Start Mosquitto → API → Web (in that order)
2. Upload firmware to ESP32 and open serial monitor
3. ESP32 connects: WiFi → MQTT → sends registration
4. Open http://localhost:3000/devices and approve the device
5. Scan an NFC card mapped to content
6. See `[Play] URL: ...` in ESP32 serial output

## URLs

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3000 |
| API | http://localhost:3001 |
| MQTT Broker | localhost:1883 |

## Environment

Make sure `packages/esp32/src/secrets.h` exists with:
```cpp
#define WIFI_SSID "your-wifi"
#define WIFI_PASS "your-password"
#define MQTT_BROKER_HOST "your-computer-ip"
#define MQTT_BROKER_PORT 1883
```

Get your IP with: `ipconfig getifaddr en0`
