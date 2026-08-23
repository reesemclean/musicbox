# AGENTS.md

Two packages, one MQTT broker (Mosquitto). The device and server talk **only** over MQTT, plus a few HTTP endpoints the device pulls (media streaming, OTA, `/api/device/config`) — there is no other device→server channel.

- `packages/web` — TanStack Start app: control-plane UI + HTTP API + SQLite (Drizzle) + the server-side MQTT client, all in one process on port 3000. Not an npm workspace; dependencies are local to this package.
- `packages/esp32` — PlatformIO firmware for the ESP32-S3 player (N16R8: 16MB flash, 8MB PSRAM).

## Read-first docs

- `docs/SYSTEM-BEHAVIOR-SPEC.md` — normative spec for device/MQTT/web behavior. Read it before touching playback, connectivity, OTA, or device lifecycle. Where `docs/ESP32-BUILD-GUIDE.md` conflicts with it (Phase 5 onward), the spec wins.
- `docs/IMPLEMENTATION-BACKLOG.md` — where work is tracked. When you finish an item, **delete** it; don't check it off. Diverge from the spec only deliberately, with a stated reason.
- `CLAUDE.md` — project conventions, including the unified `media` table design and file-storage rules.
- `DEVELOPMENT.md` — fuller local-run instructions, env-var table, device provisioning flow.

## Commands

```bash
# Setup (mise provides Node 24 + Python 3.13)
mise install && mise run setup     # Python deps + PlatformIO into .venv
cd packages/web && npm install

# Run locally — two terminals
mosquitto -c mosquitto/mosquitto.conf   # broker: 1883 devices/server, 9001 browser WebSocket
cd packages/web && npm run dev          # UI + API on http://localhost:3000

# Or closest-to-production:
DEVICE_MQTT_HOST=$(ipconfig getifaddr en0) docker compose -f docker-compose.dev.yml up --build
```

Checks — run from `packages/web`; CI runs the first three (in this order) plus `pio run` for the firmware:

```bash
npm run knip        # dead-code check — a GATE, exits non-zero on any finding (repo is at zero)
npm run build       # also regenerates src/routeTree.gen.ts — never hand-edit that file
npm test            # vitest; tests are pure logic (no React, no DB)
npx tsc --noEmit    # typecheck (not a package.json script)

npx vitest run src/lib/skip.test.ts   # single test file
```

ESP32 (from `packages/esp32`):

```bash
pio run                                  # build only
pio run -t upload && pio device monitor  # flash + serial monitor
./scripts/build-firmware.sh 1.2.3        # release build → packages/web/firmware/ for OTA
```

Releases: pushing a `v*` tag builds the production Docker image and creates a GitHub release; pushes to `main` publish a `:dev` image.

## Gotchas

- **knip is a gate, not a report.** If it flags something genuinely used, the fix is usually `knip.json` (see DEVELOPMENT.md for what's configured there and why). `src/components/ui/**` is fully ignored, so an entirely unused file in there is never flagged. An unused export in `src/server/` usually means a feature was half-wired.
- **Regenerating `package-lock.json`:** use `npx npm@11.17.0 install --package-lock-only` (matches node:24-alpine's npm). Older npm writes a tree that passes `npm ci` locally but fails **only inside Docker**, in CI.
- **No separate migrate step.** Migrations, system-sound seeding, and the MQTT connection all run at server start via `src/nitro/startup.plugin.ts` (referenced by path from `vite.config.ts`, so tooling like knip can't see the reference).
- **Real device on the LAN?** Set both `DEVICE_MQTT_HOST` and `API_BASE_URL` to your LAN IP — the `API_BASE_URL` default (`http://localhost:3001`) is stale. Vite loads `.env` from `packages/web/`, not the repo root, so pass env vars on the command line.
- **Firmware config:** `FIRMWARE_VERSION` is the only compile-time setting; `packages/esp32/build_flags.sh` reads it from `packages/esp32/.env` (default `dev`). WiFi/server URL are provisioned at runtime through a captive portal into NVS — there is no `secrets.h` and no filesystem image to upload.
- **`vitest.config.ts` is deliberately separate from `vite.config.ts`.** Don't merge them; the app's Nitro/TanStack plugin chain breaks the test run. If a new config need arises in tests, extend `vitest.config.ts`.
- Broker must be running before the server starts; the UI also needs it (port 9001, MQTT-over-WebSocket) for live device status and logs.

## Conventions

- ESP32 code: C-style C++ — prefer C idioms, simple structs, and functions over classes.
- Web UI: match the patterns in `packages/web/src/routes/_library/` and the vendored shadcn primitives in `src/components/ui/` rather than introducing a new pattern.
- Songs, podcasts, and sound-machine sounds share one `media` table with a `type` discriminator; media files live on disk under `DATA_DIR`, never in the DB. Details in CLAUDE.md.
