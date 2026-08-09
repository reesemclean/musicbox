# MusicBox Development

Two packages, one broker:

- `packages/web` — TanStack Start app. Serves the control-plane UI, the HTTP
  API, the SQLite database, and the server-side MQTT client, all from one
  process on port 3000.
- `packages/esp32` — PlatformIO firmware for the ESP32-S3 player.
- Mosquitto — MQTT broker. Everything between server and device goes through
  it; there is no direct HTTP or WebSocket connection from device to server
  except media streaming, OTA, and `/api/device/config`.

For how the system is *supposed* to behave, read `docs/SYSTEM-BEHAVIOR-SPEC.md`.
This file only covers getting it running.

## Prerequisites

[mise](https://mise.jdx.dev) provides Node 24 and Python 3.13, and creates the
`.venv` the ESP32 tooling lives in:

```bash
mise install
mise run setup     # Python deps + PlatformIO into .venv
```

Then install the web dependencies:

```bash
cd packages/web && npm install
```

## Running it

### Option A: Docker Compose (closest to production)

Brings up the server and a broker with both the plain and WebSocket listeners
configured:

```bash
DEVICE_MQTT_HOST=$(ipconfig getifaddr en0) docker compose -f docker-compose.dev.yml up --build
```

`DEVICE_MQTT_HOST` must be an address a device on your LAN can reach — it is
what the server hands out from `/api/device/config`. It defaults to
`localhost`, which is useless to a device.

### Option B: Local processes

Two terminals:

```bash
# 1. Broker
mosquitto -c mosquitto/mosquitto.conf

# 2. Server (http://localhost:3000)
cd packages/web && npm run dev
```

Migrations, system-sound seeding, and the MQTT connection all run
automatically at server start — there is no separate migrate step.

**If a real device is involved, set two env vars.** Their defaults point at
`localhost` and a port that no longer exists, so a device will connect to
nothing:

```bash
cd packages/web
DEVICE_MQTT_HOST=$(ipconfig getifaddr en0) \
API_BASE_URL=http://$(ipconfig getifaddr en0):3000 \
npm run dev
```

The `.env` in the repo root is what Docker Compose consumes. Don't count on
`vite dev` picking it up — Vite loads `.env` from `packages/web/`, so set the
vars explicitly as above.

**The dev broker config listens on 1883 only.** The browser UI subscribes over
MQTT-over-WebSocket on 9001 for live playback status and device logs; without
that listener the UI still works and commands still reach devices (those go
through the server), but status panels won't update live. Add it to
`mosquitto/mosquitto.conf` if you want them:

```
listener 9001
protocol websockets
allow_anonymous true
```

### ESP32

```bash
cd packages/esp32

pio run -t upload && pio device monitor   # build, flash, watch
pio run                                   # build only
pio device monitor                        # monitor only
```

There is no `secrets.h`, and no filesystem image to upload. `FIRMWARE_VERSION`
is the only compile-time configuration (see `build_flags.sh`, which reads it
from the root `.env`); WiFi credentials and the server URL are provisioned at
runtime into NVS, and system sounds are downloaded from the server into
LittleFS on any boot where they're missing.

## First boot of a device

1. An unprovisioned device starts a captive portal on SSID `MusicBox-Setup`.
   Join it, enter your WiFi credentials and the server URL
   (`http://<your-ip>:3000`). The device stores both in NVS and restarts.
2. It connects to WiFi, fetches the broker address from
   `/api/device/config`, connects to MQTT, and publishes a registration.
3. Approve it at http://localhost:3000/devices. Approval pushes a `config`
   command and the device plays its startup sound.
4. The device downloads `startup.mp3`, `scan.mp3`, and `error.mp3` from
   `/api/sounds/` into local flash. It re-fetches only what's missing, so
   this is a no-op on later boots.

## Testing the full flow

1. Start broker, then server, then power on the device.
2. Map a card to a song, playlist, or podcast feed under `/cards`.
3. Scan it. The device plays the read cue immediately, publishes
   `card_scanned`, and waits for the server to push back a `play` — card
   mappings are resolved server-side on every scan, so nothing is cached on
   the device.
4. Watch the serial monitor, or the device log panel in the UI, for the
   resolved stream URL.

## Firmware builds & OTA

```bash
./scripts/build-firmware.sh 1.2.3
```

Builds with `FIRMWARE_VERSION=1.2.3` and copies `firmware.bin` plus a manifest
into `packages/web/firmware/`, where the OTA endpoints serve it from. The
production image builds firmware the same way and embeds it.

## Checks

```bash
cd packages/web
npm test          # vitest
npm run knip      # unused files, exports, and dependencies
npm run build     # also regenerates src/routeTree.gen.ts
```

CI runs all three on `packages/web`, plus `pio run` for the firmware.

### knip

[knip](https://knip.dev) finds code and dependencies nothing references. It
runs in CI and **exits non-zero on any finding**, so it is a gate, not a
report — the repo is currently at zero.

If it flags something you believe is genuinely used, the fix is usually
`knip.json` rather than the code. What's already configured there, and why:

- `entry` — `src/nitro/startup.plugin.ts` is referenced by path from
  `vite.config.ts`, so knip can't see it. Everything else is discovered by
  knip's Vite/TanStack/Vitest/Drizzle plugins; don't add entries it can find
  on its own, or it will tell you they're redundant.
- `ignoreBinaries` — `ffmpeg` and `yt-dlp` are system dependencies, not npm
  ones.
- `ignoreExportsUsedInFile` — the MQTT command/event types in
  `services/mqttService.ts` are exported for documentation but consumed
  within their own file to build the `DeviceCommand` union.
- `ignore: src/components/ui/**` — vendored shadcn primitives are
  deliberately complete, so their unused exports aren't findings. **Note this
  also means an entirely unused file in there won't be flagged.**

Server functions are only reachable if something imports them, so an unused
export in `src/server/` usually means a feature was half-wired rather than
that the code is harmless.

## Ports

| Service | URL |
|---------|-----|
| Web UI + API | http://localhost:3000 |
| MQTT | localhost:1883 |
| MQTT over WebSocket (browser) | ws://localhost:9001 |

## Environment variables

Server-side, all optional in local dev unless a real device is involved:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEVICE_MQTT_HOST` | `localhost` | Broker address handed to devices via `/api/device/config` |
| `DEVICE_MQTT_PORT` | `1883` | Broker port handed to devices |
| `API_BASE_URL` | `http://localhost:3001` | Base for stream URLs the server puts in `play` commands — **the default is stale; set it** |
| `STREAM_BASE_URL` | falls back to `API_BASE_URL` | Override if media streams are served from a different host |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | Broker the *server* connects to |
| `DATABASE_URL` | `musicbox.db` (in `packages/web/`) | SQLite file |
| `DATA_DIR` | `packages/web/data` | Media files on disk |
| `VITE_MQTT_WS_URL` | `ws://<page host>:9001` | Broker WebSocket URL for the browser |
| `MUSICBOX_SKIP_PODCAST_REFRESH` | unset | Skip the scheduled feed refresh |
| `MUSICBOX_SKIP_MEDIA_BACKFILL` | unset | Skip the startup media backfill pass |
