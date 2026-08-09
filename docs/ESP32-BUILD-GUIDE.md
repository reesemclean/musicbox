# MusicBox ESP32 Build Guide

A step-by-step guide to building the MusicBox ESP32 player from scratch. Each step is incremental, testable, and builds toward the complete system.

> **Status: partly historical.** This guide records how the system was
> originally built, and parts of it describe an architecture that has since
> been replaced. Still accurate: the hardware components, pin reference, and
> the incremental bring-up in Phases 1–4 and 6 (audio, NFC, buttons, WiFi).
>
> Superseded, and kept only as a record of how things got here:
>
> - **Phase 5 (SD Card Storage)** — there is no SD card. The device holds
>   system sounds and one sound-machine file in onboard flash (LittleFS) and
>   streams everything else. No SD module is needed to build one.
> - **Everything from Phase 7 onward** — these phases build a separate Hono
>   API service on port 3001 talking to the device over a WebSocket at
>   `/ws/device`. Neither exists. The TanStack Start app in `packages/web`
>   serves the UI, the API, and the database from one process on port 3000,
>   and device↔server messaging is MQTT through a Mosquitto broker. The
>   features these phases cover are real; only the architecture they
>   describe is obsolete.
>
> For how the system behaves today, read
> [`SYSTEM-BEHAVIOR-SPEC.md`](./SYSTEM-BEHAVIOR-SPEC.md) — it is normative,
> and this guide is not. For running it, see
> [`../DEVELOPMENT.md`](../DEVELOPMENT.md).

## Philosophy

- **One thing at a time**: Each step adds exactly one capability
- **Verify before proceeding**: Every step includes validation criteria
- **Hardware first**: Wire and test hardware before writing integration code
- **Isolated testing**: Each component gets its own test before integration

---

## System Architecture

The MusicBox system consists of three main components:

```
┌─────────────────────────────────────────────────────────────────────┐
│  CONTROL PLANE UI (browser)                                         │
│  Library • Playlists • Cards • Devices • Podcasts • Downloads       │
│                                                                     │
│  Commands go through the server. Subscribes to MQTT over            │
│  WebSocket (:9001) for live status — never commands a device.       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / server functions
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SERVER — packages/web (TanStack Start, :3000)                      │
│  UI + API + database + MQTT bridge, all in one process              │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ MQTT client  │  │  HTTP API    │  │ SQLite (Drizzle)          │  │
│  │  (bridge)    │  │  /api/*      │  │ Media, Cards, Devices...  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────────┘  │
└─────────┼─────────────────┼─────────────────────────────────────────┘
          │                 │
          │ MQTT            │ HTTP (the device pulls)
          ▼                 │   /api/device/config
┌──────────────────────┐    │   /api/media/stream/:id
│   MQTT BROKER        │    │   /api/playlists/stream/:id
│   Mosquitto (:1883)  │    │   /api/sounds/*, /api/firmware/*
└──────────┬───────────┘    │
           │ commands ↓     │
           │ events   ↑     │
           ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ESP32 PLAYER                                                       │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────────┐ ┌────────┐          │
│  │  NFC   │ │ Audio  │ │ Buttons │ │ LittleFS │ │  OTA   │          │
│  │ PN532  │ │  I2S   │ │   x5    │ │  cues +  │ │        │          │
│  │        │ │        │ │         │ │  1 loop  │ │        │          │
│  └────────┘ └────────┘ └─────────┘ └──────────┘ └────────┘          │
│                                                                     │
│  Holds no card mappings and no play queue — every scan is           │
│  resolved by the server, and a playlist arrives as one stream.      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Development Environment

- **PlatformIO**: Install via VS Code extension or CLI (`mise run setup`
  installs it into the project venv)
- **Node.js 24**: For the server and Control Plane
- **Git**: Version control

### Hardware Components

| Component | Part | Notes |
|-----------|------|-------|
| MCU | ESP32-S3-DevKitC-1-N16R8 | 16MB flash, 8MB PSRAM, USB-C |
| NFC Reader | PN532 V3 Module | Must support I2C mode |
| Audio Amp | MAX98357A | I2S DAC with built-in amp |
| Speaker | 4Ω or 8Ω, 3W | Small form factor |
| Buttons | 5x Momentary pushbuttons | Any tactile switches |
| Breadboard | Full-size recommended | For prototyping |
| Jumper wires | Male-to-male, male-to-female | Assorted |
| Capacitors | 100µF electrolytic, 0.1µF ceramic | For power filtering |
| Resistors | 2x 4.7kΩ | I2C pull-ups (may not be needed) |

### Pin Reference

Keep this reference handy throughout the build:

```
ESP32-S3-DevKitC-1-N16R8 Pin Assignments
========================================

I2S Audio (MAX98357A):
  GPIO4  → BCLK
  GPIO5  → LRC (Word Select)
  GPIO6  → DIN (Data)

I2C (PN532 NFC):
  GPIO8  → SDA
  GPIO9  → SCL

Buttons (active low, as wired in main.cpp):
  GPIO10 → Previous Track
  GPIO11 → Play/Pause
  GPIO12 → Next Track
  GPIO13 → Volume Up
  GPIO14 → Volume Down

Power:
  3.3V   → PN532 VCC, I2C pull-ups
  5V     → MAX98357A VIN
  GND    → All grounds (common)

Reserved (do not use):
  GPIO19/20  → USB
  GPIO26-32  → Internal flash
  GPIO35-37  → PSRAM
```

---

## Phase 1: ESP32 Foundation

### Step 1.1: ESP32 Hello World

**Goal**: Verify the ESP32 dev board works and PlatformIO is configured correctly.

**What to do**:
1. Create a new PlatformIO project targeting `esp32-s3-devkitc-1`
2. Write a minimal program that prints to serial
3. Upload and verify output via serial monitor

**Verification**:
- Serial output appears at 115200 baud
- USB CDC serial works (no external UART needed)
- Board reboots cleanly

**platformio.ini settings**:
```ini
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
build_flags = -DARDUINO_USB_CDC_ON_BOOT=1
```

**Success criteria**: "Hello World" prints to serial monitor every second.

---

### Step 1.2: PSRAM Verification

**Goal**: Confirm the N16R8 variant's 8MB PSRAM is detected and usable.

**What to do**:
1. Add PSRAM detection code to startup
2. Allocate a test buffer in PSRAM
3. Write and read back data to verify integrity

**Verification**:
- `psramFound()` returns true
- `ESP.getPsramSize()` reports ~8MB (8,388,608 bytes)
- Test allocation succeeds

**Build flags to add**:
```ini
build_flags =
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_CDC_ON_BOOT=1
```

**Success criteria**: Serial output shows "PSRAM: 8388608 bytes" (or similar).

---

## Phase 2: Audio Output

### Step 2.1: MAX98357A Wiring

**Goal**: Wire the I2S DAC/amplifier to the ESP32.

**Wiring diagram**:
```
ESP32-S3                MAX98357A
─────────               ─────────
GPIO4  ────────────────► BCLK
GPIO5  ────────────────► LRC
GPIO6  ────────────────► DIN
5V     ───┬────────────► VIN
          │
         ═══ 100µF (electrolytic, negative to GND)
          │
         ═══ 0.1µF (ceramic, parallel)
          │
GND    ───┴────────────► GND

                        Speaker
                        ────────
              Speaker+ ◄──────── +
              Speaker- ◄──────── -
```

**Power filtering notes**:
- The 100µF electrolytic capacitor provides bulk filtering
- The 0.1µF ceramic capacitor filters high-frequency noise
- Place capacitors as close to the MAX98357A VIN pin as possible
- Insufficient filtering causes audible noise/hum

**GAIN pin options** (leave unconnected for 9dB default):
- Unconnected: 9dB gain
- Connected to GND: 12dB gain
- Connected to VIN: 15dB gain

**SD pin** (shutdown):
- Leave unconnected or tie to VIN for always-on
- Can be controlled by GPIO for power management (optional)

**Verification**:
- No smoke when powered on
- Measure 5V at VIN pin
- Measure ~3.3V at BCLK/LRC/DIN pins when ESP32 is running

---

### Step 2.2: I2S Audio Test

**Goal**: Play a test tone through the speaker.

**What to do**:
1. Configure I2S output on GPIO 4, 5, 6
2. Generate a simple sine wave or square wave
3. Output to the DAC

**Library**: Arduino built-in I2S or ESP-IDF I2S driver

**Verification**:
- Audible tone from speaker
- No distortion or crackling
- Volume is reasonable (not too quiet, not clipping)

**Troubleshooting**:
- No sound: Check wiring, especially BCLK/LRC/DIN
- Crackling: Add/improve power filtering capacitors
- Very quiet: Check GAIN pin configuration
- Distorted: Lower software volume, check speaker impedance

**Success criteria**: Clear, steady tone plays from speaker.

---

### Step 2.3: MP3 Playback Test

**Goal**: Decode and play an MP3 file from flash/PROGMEM.

**What to do**:
1. Embed a short MP3 file in the firmware
2. Use ESP32-audioI2S library to decode and play
3. Verify clean playback start to finish

**Library**: `schreibfaul1/ESP32-audioI2S`

**Note**: Pin to a stable version. The library's `main` branch may require C++20 features not available in the Arduino ESP32 toolchain. Version 3.0.12 or earlier is recommended.

**Verification**:
- MP3 plays without skipping or artifacts
- Playback completes without crashes
- Memory usage is reasonable

**Success criteria**: Embedded MP3 plays clearly from start to end.

---

## Phase 3: NFC Reader

### Step 3.1: PN532 Wiring (I2C Mode)

**Goal**: Wire the PN532 NFC reader for I2C communication.

**Mode selection**: The PN532 module has DIP switches or solder jumpers to select the communication mode. Set for I2C:
- Check your specific module's documentation
- Common settings: HSU=OFF, I2C=ON, SPI=OFF

**Wiring diagram**:
```
ESP32-S3                PN532
─────────               ─────
GPIO8  ────────────────► SDA
GPIO9  ────────────────► SCL
3.3V   ────────────────► VCC
GND    ────────────────► GND

Optional I2C pull-ups (may not be needed if module has them):
3.3V ──┬─── 4.7kΩ ───── SDA
       │
       └─── 4.7kΩ ───── SCL
```

**I2C address**: 0x24 (default for PN532)

**Verification**:
- Measure 3.3V at VCC pin
- No excessive current draw (module shouldn't get hot)

---

### Step 3.2: PN532 Communication Test

**Goal**: Verify I2C communication with the PN532.

**What to do**:
1. Initialize I2C on GPIO 8 (SDA) and GPIO 9 (SCL)
2. Scan I2C bus to find device at address 0x24
3. Read firmware version from PN532

**Library**: `adafruit/Adafruit PN532`

**Verification**:
- I2C scan finds device at 0x24
- Firmware version command returns valid data (e.g., "PN532 firmware v1.6")

**Troubleshooting**:
- Device not found: Check mode selection switches, wiring
- Intermittent: Add/check I2C pull-up resistors
- Wrong address: Some clones use different addresses

**Success criteria**: PN532 firmware version prints to serial.

---

### Step 3.3: NFC Card Reading Test

**Goal**: Read NFC card UIDs.

**What to do**:
1. Configure PN532 for ISO14443A card detection
2. Poll for cards
3. Print UID when card is detected

**Verification**:
- Card detection works within ~5cm
- UID is consistent for the same card
- Different cards show different UIDs
- Detection is reliable (>95% success rate on tap)

**Card types to test**:
- MIFARE Classic (most common NFC cards)
- NTAG213/215/216 (common NFC tags)
- NFC-enabled phone (may work, not required)

**Success criteria**: Tap a card, UID prints to serial within 200ms.

---

### Step 3.4: NFC Debouncing

**Goal**: Prevent duplicate reads when card is held on reader.

**What to do**:
1. Track last read UID and timestamp
2. Ignore same UID within debounce window (1.5s, per spec §9)
3. Allow new card to be read immediately

**Verification**:
- Hold card on reader: only one read event
- Remove and re-tap: new read event
- Tap different card while first is still near: new read event

**Success criteria**: Single tap = single read event, regardless of how long card is held.

---

## Phase 4: Button Input

### Step 4.1: Button Wiring

**Goal**: Wire 5 buttons with hardware debouncing via internal pull-ups.

**Wiring diagram** (active low, internal pull-ups):
```
ESP32-S3                Buttons
─────────               ───────
GPIO10 ─────────┬────── Prev Track  ───── GND
                │
GPIO11 ─────────┼────── Play/Pause  ───── GND
                │
GPIO12 ─────────┼────── Next Track  ───── GND
                │
GPIO13 ─────────┼────── Volume Up   ───── GND
                │
GPIO14 ─────────┴────── Volume Down ───── GND
```

**Notes**:
- Using internal pull-ups, so no external resistors needed
- Buttons connect GPIO to GND when pressed
- Active low: pressed = LOW, released = HIGH

**Verification**:
- Each GPIO reads HIGH when button not pressed
- Each GPIO reads LOW when button pressed
- No floating or unstable readings

---

### Step 4.2: Button Input Test

**Goal**: Detect button presses with software debouncing.

**What to do**:
1. Configure GPIOs as INPUT_PULLUP
2. Implement debouncing (`main.cpp` uses 20ms)
3. Print button events to serial

**Library**: `lennarthennigs/Button2`

**Verification**:
- Each button registers exactly once per press
- No phantom presses
- All 5 buttons work independently

**Success criteria**: Press each button, see corresponding event in serial.

---

### Step 4.3: Long Press Detection

**Goal**: Detect long press on Play/Pause button (for sound machine).

**What to do**:
1. Track press duration for Play/Pause button
2. Trigger a different event for a press past the long-click threshold
   (`main.cpp` uses 1000ms)
3. Distinguish between click and long press

**Verification**:
- Quick press: "click" event
- Hold past the threshold: "long press" event
- Long press doesn't also trigger click on release

**Success criteria**: Long press triggers distinct event from normal press.

---

## Phase 5: SD Card Storage

### Step 5.1: SD Card Module Wiring

**Goal**: Wire SD card module for SPI communication.

**Wiring diagram**:
```
ESP32-S3                SD Card Module
─────────               ──────────────
GPIO38 ────────────────► CLK
GPIO39 ────────────────► MOSI (DI)
GPIO40 ────────────────► MISO (DO)
GPIO41 ────────────────► CS
5V     ────────────────► VCC
GND    ────────────────► GND
```

**Notes**:
- Most SD card modules have onboard 3.3V regulator, so 5V VCC is fine
- Some modules are 3.3V only - check your specific module
- Use a quality SD card (Class 10 or better)

**Verification**:
- Measure appropriate voltage at VCC
- No excessive current draw

---

### Step 5.2: SD Card Mount Test

**Goal**: Mount SD card and read filesystem info.

**What to do**:
1. Initialize SPI on GPIO 38-41
2. Mount SD card filesystem
3. Print card type, size, and free space

**Library**: Arduino SD library (built-in)

**Verification**:
- Card type detected (SD, SDHC, etc.)
- Total size matches card capacity
- Free space is reported

**Troubleshooting**:
- Mount fails: Check wiring, try different SD card
- Wrong size: Card may need reformatting (FAT32)
- Intermittent: Check connections, SPI speed

**Success criteria**: SD card info prints correctly.

---

### Step 5.3: SD Card Read/Write Test

**Goal**: Verify file read/write operations.

**What to do**:
1. Create a test file
2. Write test data
3. Read back and verify
4. Delete test file

**Verification**:
- File creates successfully
- Data reads back correctly
- File deletes successfully
- Works with various file sizes (1KB, 1MB, 10MB)

**Success criteria**: Write 1MB file, read back, data matches.

---

## Phase 6: WiFi Connectivity

### Step 6.1: WiFi Connection

**Goal**: Connect to WiFi network.

**What to do**:
1. Configure WiFi credentials (use secrets file, gitignored)
2. Connect to network
3. Print IP address

**Verification**:
- Connects within 10 seconds
- IP address is valid for your network
- Ping device from computer succeeds

**Secrets management**:
- Create `secrets.h` file with SSID and password
- Add to `.gitignore`
- Provide `secrets.h.example` template

> **Superseded.** There is no `secrets.h` — `FIRMWARE_VERSION` is the only
> compile-time setting (`build_flags.sh`). Credentials and the server URL are
> entered through the captive portal on first boot and stored in NVS, so one
> firmware image works on every device. See spec §1.1.

**Success criteria**: ESP32 connects to WiFi, IP address prints to serial.

---

### Step 6.2: HTTP Client Test

**Goal**: Make HTTP requests to external server.

**What to do**:
1. Make GET request to a test endpoint
2. Parse response
3. Handle timeouts and errors gracefully

**Verification**:
- Successful GET request
- Response body received correctly
- Timeout handling works

**Test endpoint**: Use a public API or your own test server.

**Success criteria**: HTTP GET returns expected response.

---

### Step 6.3: WiFi Reconnection

**Goal**: Handle WiFi disconnection gracefully.

**What to do**:
1. Detect WiFi disconnection
2. Attempt reconnection with backoff
3. Continue operation during disconnection (if possible)

**Verification**:
- Disable WiFi (turn off router): device detects disconnection
- Re-enable WiFi: device reconnects automatically
- Multiple disconnect/reconnect cycles work

**Success criteria**: Device recovers from WiFi loss without manual intervention.

---

## Phase 7: API Service Foundation

### Step 7.1: Hono Project Bootstrap

**Goal**: Create the API server project with basic structure.

**What to do**:
1. Create new Node.js package in `packages/api`
2. Configure TypeScript
3. Set up Hono with basic middleware (logger, cors)
4. Create health check endpoint

**Libraries**:
- `hono` - Web framework
- `@hono/node-server` - Node.js adapter
- `tsx` - TypeScript execution
- `ws` - WebSocket server

**Project structure**:
```
packages/api/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
└── src/
    ├── index.ts      # Server entry point
    └── db/
        ├── index.ts  # Database connection
        └── schema.ts # Table definitions
```

**Verification**:
- Server starts on configured port
- `GET /health` returns `{"status": "ok"}`
- Logs show requests

**Success criteria**: `curl http://localhost:3001/health` returns OK.

---

### Step 7.2: Database Setup

**Goal**: Set up SQLite database with Drizzle ORM.

**What to do**:
1. Add Drizzle ORM and better-sqlite3
2. Create initial schema (devices table only)
3. Set up migrations
4. Verify database creation

**Libraries**:
- `drizzle-orm` - ORM
- `better-sqlite3` - SQLite driver
- `drizzle-kit` - Migration tooling

**Initial schema** (devices table):
- id (primary key)
- mac (unique)
- name
- secret (unique, for authentication)
- status (pending, approved, rejected)
- firmwareVersion
- lastSeen
- lastIp
- soundMachineSound
- createdAt

**Verification**:
- `npm run db:push` creates database file
- Table exists with correct columns
- Can insert and query test data

**Success criteria**: Database file created, devices table exists.

---

### Step 7.3: WebSocket Server

**Goal**: Add WebSocket support for device connections.

**What to do**:
1. Create raw HTTP server (for WebSocket upgrade)
2. Attach WebSocket server on `/ws/device` path
3. Handle connection, message, and close events
4. Test with WebSocket client

**Library**: `ws`

**Note**: Using raw Node.js HTTP server instead of Hono's built-in server is required for WebSocket support.

**Verification**:
- WebSocket client can connect
- Messages send and receive
- Connection close handled cleanly

**Test tool**: Use `websocat`, Postman, or browser dev tools.

**Success criteria**: WebSocket echo test passes.

---

### Step 7.4: Songs Table & Streaming

**Goal**: Store and stream audio files.

**What to do**:
1. Add songs table (id, title, artist, album, duration, mimeType, fileSize, fileData)
2. Create `GET /api/stream/:songId` endpoint
3. Return audio blob with correct headers

**Schema (songs table)**:
- id (primary key)
- title
- artist (nullable)
- album (nullable)
- duration (seconds, nullable)
- mimeType (audio/mpeg, audio/mp4, etc.)
- fileSize (bytes)
- fileData (blob)
- createdAt

**Verification**:
- Endpoint returns audio data
- Content-Type header is correct
- File plays in browser or media player

**Success criteria**: `curl` downloads playable audio file.

---

### Step 7.5: Cards Table & Mapping

**Goal**: Map NFC cards to content.

**What to do**:
1. Add cards table
2. Support multiple content types (song, playlist, action)
3. Create lookup function

**Schema (cards table)**:
- id (primary key)
- uid (unique, hex string)
- name (nullable, friendly name)
- contentType (song, playlist, action)
- songId (nullable, foreign key)
- playlistId (nullable, foreign key)
- action (nullable: play, pause, next, prev, stop)
- createdAt

**Verification**:
- Can create card mappings
- Lookup by UID works
- Returns correct content reference

**Success criteria**: Database query returns content for card UID.

---

### Step 7.6: Playlists Tables

**Goal**: Support playlists with ordered songs.

**What to do**:
1. Add playlists table
2. Add playlist_songs junction table with position
3. Create playlist query with songs

**Schema (playlists table)**:
- id (primary key)
- name
- createdAt

**Schema (playlist_songs table)**:
- id (primary key)
- playlistId (foreign key)
- songId (foreign key)
- position (ordering)

**Verification**:
- Create playlist with songs
- Query returns songs in order
- Position updates work

**Success criteria**: Playlist returns ordered song list.

---

### Step 7.7: Firmware Table & OTA Endpoints

**Goal**: Support over-the-air updates.

**What to do**:
1. Add firmware table
2. Create version check endpoint
3. Create firmware download endpoint

**Schema (firmware table)**:
- id (primary key)
- version (unique, semantic versioning)
- sha256 (hash for verification)
- fileData (blob)
- fileSize
- createdAt

**Endpoints**:
- `GET /api/firmware/latest.json` - Returns latest version info
- `GET /api/firmware/:version.bin` - Downloads firmware binary

**Verification**:
- Version endpoint returns correct format
- Binary download works
- SHA256 matches content

**Success criteria**: Firmware endpoints return correct data.

---

## Phase 8: Control Plane Foundation

### Step 8.1: TanStack Start Project Bootstrap

**Goal**: Create the web UI project with TanStack Start.

**What to do**:
1. Create new package in `packages/web`
2. Configure TanStack Start with React
3. Set up Tailwind CSS for styling
4. Create basic layout with navigation

**Libraries**:
- `@tanstack/react-start` - Full-stack React framework
- `@tanstack/react-router` - File-based routing
- `@tanstack/react-query` - Data fetching
- `tailwindcss` - Styling

**Project structure**:
```
packages/web/
├── package.json
├── app.config.ts
└── src/
    ├── routes/
    │   ├── __root.tsx    # Root layout
    │   └── index.tsx     # Home page
    ├── components/
    └── lib/
        └── api-client.ts # API service client
```

**Verification**:
- Dev server starts
- Home page renders
- Navigation works

**Success criteria**: Web app loads with basic layout.

---

### Step 8.2: API Client Setup

**Goal**: Create client for communicating with API service.

**What to do**:
1. Create fetch wrapper for API calls
2. Configure base URL (environment variable)
3. Add error handling

**Verification**:
- Can call API health endpoint
- Errors handled gracefully
- Works in both dev and production

**Success criteria**: Control plane can communicate with API service.

---

### Step 8.3: Songs Library Page

**Goal**: Display and manage the song library.

**What to do**:
1. Create `/library` route
2. Display songs in table/grid
3. Show song metadata (title, artist, album, duration)
4. Add search/filter capability

**API endpoints needed**:
- `GET /api/songs` - List all songs (metadata only, no blob)

**Verification**:
- Songs display correctly
- Search filters results
- Empty state handled

**Success criteria**: Library page shows all songs.

---

### Step 8.4: Song Upload

**Goal**: Upload new songs to the library.

**What to do**:
1. Add upload button/dialog
2. Accept audio files (MP3, M4A, FLAC, WAV, OGG)
3. Extract metadata (use music-metadata library on API)
4. Store in database

**API endpoints needed**:
- `POST /api/songs` - Upload song (multipart form data)

**Libraries** (API side):
- `music-metadata` - Extract audio metadata

**Verification**:
- Upload dialog works
- File uploads successfully
- Metadata extracted correctly
- Song appears in library

**Success criteria**: Can upload song and see it in library.

---

### Step 8.5: Song Management

**Goal**: Edit and delete songs.

**What to do**:
1. Add edit dialog for song metadata
2. Add delete with confirmation
3. Support bulk delete

**API endpoints needed**:
- `PATCH /api/songs/:id` - Update metadata
- `DELETE /api/songs/:id` - Delete song

**Verification**:
- Can edit song title, artist, album
- Delete removes song
- Bulk delete works

**Success criteria**: Full CRUD for songs.

---

### Step 8.6: Playlists Page

**Goal**: Create and manage playlists.

**What to do**:
1. Create `/playlists` route
2. Display playlists with song count
3. Add create playlist dialog
4. Add delete playlist

**API endpoints needed**:
- `GET /api/playlists` - List playlists with song counts
- `POST /api/playlists` - Create playlist
- `DELETE /api/playlists/:id` - Delete playlist

**Verification**:
- Playlists display with counts
- Create new playlist works
- Delete removes playlist

**Success criteria**: Can create and delete playlists.

---

### Step 8.7: Playlist Detail Page

**Goal**: View and edit playlist contents.

**What to do**:
1. Create `/playlists/:id` route
2. Display songs in playlist order
3. Add/remove songs from playlist
4. Reorder songs (drag and drop)

**API endpoints needed**:
- `GET /api/playlists/:id` - Get playlist with songs
- `POST /api/playlists/:id/songs` - Add song to playlist
- `DELETE /api/playlists/:id/songs/:songId` - Remove song
- `PATCH /api/playlists/:id/songs` - Reorder songs

**Libraries**:
- `@dnd-kit/core` - Drag and drop

**Verification**:
- Songs display in order
- Can add songs from library
- Can remove songs
- Drag to reorder works

**Success criteria**: Full playlist management.

---

### Step 8.8: Cards Page

**Goal**: Manage NFC card mappings.

**What to do**:
1. Create `/cards` route
2. Display all cards with their mappings
3. Show card UID and linked content
4. Add edit/delete capabilities

**API endpoints needed**:
- `GET /api/cards` - List all cards
- `DELETE /api/cards/:id` - Delete card

**Verification**:
- Cards display with content info
- Delete removes card

**Success criteria**: Can view and delete cards.

---

### Step 8.9: Card Registration Flow

**Goal**: Register new NFC cards.

**What to do**:
1. Add "Register Card" flow
2. Wait for card scan from device (via WebSocket event)
3. Show card UID when scanned
4. Select content to link (song, playlist, or action)
5. Save mapping

**Flow**:
1. User clicks "Register Card"
2. UI shows "Waiting for card scan..."
3. User taps card on device
4. Device sends `card_scanned` event via WebSocket
5. API forwards event to Control Plane (via separate WebSocket or polling)
6. UI shows UID and prompts for content selection
7. User selects song, playlist, or action
8. Card mapping saved

**API endpoints needed**:
- `POST /api/cards` - Create card mapping
- WebSocket or SSE for real-time card scan events

**Verification**:
- Can initiate registration
- Card scan detected
- Can link to song
- Can link to playlist
- Can create action card

**Success criteria**: End-to-end card registration works.

---

### Step 8.10: Devices Page

**Goal**: Manage connected devices.

**What to do**:
1. Create `/devices` route
2. Display all devices with status
3. Show online/offline status
4. Show firmware version, last seen, IP

**API endpoints needed**:
- `GET /api/devices` - List all devices

**Verification**:
- Devices display with status
- Online devices show as online
- Last seen time displays

**Success criteria**: Can view all devices.

---

### Step 8.11: Device Approval Flow

**Goal**: Approve pending devices.

**What to do**:
1. Show pending devices prominently
2. Add approve/reject buttons
3. Allow device renaming
4. Show device secret after approval

**API endpoints needed**:
- `PATCH /api/devices/:id` - Update device status/name
- `DELETE /api/devices/:id` - Delete device

**Verification**:
- Pending devices highlighted
- Approve changes status
- Reject changes status
- Can rename device

**Success criteria**: Full device management workflow.

---

### Step 8.12: Device Remote Control

**Goal**: Control device playback from web UI.

**What to do**:
1. Add playback controls per device
2. Send play/pause/stop/next/prev commands
3. Show current playback status
4. Volume control

**API endpoints needed**:
- `POST /api/devices/:id/command` - Send command to device

**Commands**: play, pause, stop, next, prev, volume

**Verification**:
- Commands sent successfully
- Device responds
- Status updates

**Success criteria**: Can control device from web UI.

---

### Step 8.13: Downloads Page (YouTube Music)

**Goal**: Download music from YouTube Music.

**What to do**:
1. Create `/downloads` route
2. Add search interface for YouTube Music
3. Queue downloads
4. Show download progress

**API requirements**:
- YouTube Music search (using ytmusicapi)
- Download queue management
- Progress tracking

**Libraries** (API side):
- `ytmusicapi` (Python) - YouTube Music API
- `yt-dlp` - Audio download

**Note**: This requires Python with ytmusicapi for search and yt-dlp for downloads. The API service will need to shell out to these tools.

**Verification**:
- Can search YouTube Music
- Can queue download
- Progress shows
- Downloaded songs appear in library

**Success criteria**: End-to-end music download works.

---

### Step 8.14: Download Queue Management

**Goal**: Manage pending and failed downloads.

**What to do**:
1. Show queue status (pending, downloading, complete, failed)
2. Retry failed downloads
3. Cancel pending downloads
4. Bulk album download with auto-playlist creation

**Verification**:
- Queue status accurate
- Retry works
- Cancel works
- Album download creates playlist

**Success criteria**: Full download queue management.

---

### Step 8.15: Podcasts Page

**Goal**: Subscribe to and manage podcast feeds.

**What to do**:
1. Create `/podcasts` route
2. Add podcast feed via RSS URL
3. Display episodes
4. Download episodes

**API requirements**:
- RSS feed parsing
- Episode storage
- Periodic feed refresh

**Verification**:
- Can add podcast feed
- Episodes display
- Can download episodes
- Feed refreshes

**Success criteria**: Podcast subscription works.

---

### Step 8.16: Sound Machine Configuration

**Goal**: Configure sound machine per device.

**What to do**:
1. Add sound selection to device settings
2. Provide built-in sounds (rain, white noise, etc.)
3. Store preference per device

**Verification**:
- Can select sound
- Preference saved
- Device uses correct sound on long press

**Success criteria**: Sound machine configurable per device.

---

### Step 8.17: Firmware Management

**Goal**: Upload and manage firmware versions.

**What to do**:
1. Create firmware management section
2. Upload new firmware versions
3. View version history
4. Trigger OTA update on devices

**API endpoints needed**:
- `GET /api/firmware` - List all versions
- `POST /api/firmware` - Upload new version
- `POST /api/devices/:id/update` - Trigger OTA

**Verification**:
- Can upload firmware
- SHA256 computed correctly
- Can trigger update
- Device updates

**Success criteria**: End-to-end OTA management.

---

## Phase 9: ESP32-API Integration

### Step 9.1: WebSocket Client on ESP32

**Goal**: ESP32 connects to API WebSocket.

**What to do**:
1. Add WebSocket client library
2. Connect to `ws://{server}:3001/ws/device`
3. Send "connected" event with device info
4. Handle reconnection on disconnect

**Library**: `links2004/WebSockets`

**Message format**:
```json
{
  "event": "connected",
  "mac": "AA:BB:CC:DD:EE:FF",
  "version": "1.0.0",
  "ip": "192.168.1.100"
}
```

**Verification**:
- ESP32 connects to API
- API logs show connection
- "connected" event received by API

**Success criteria**: API shows "Device connected: XX:XX:XX:XX:XX:XX".

---

### Step 9.2: Device Registration Flow

**Goal**: Implement device registration in API.

**What to do**:
1. On "connected" event, check if device exists
2. If new, create pending device record
3. Return device status to ESP32
4. Device approved via Control Plane

**Verification**:
- New device appears in database as "pending"
- Approved device receives secret
- Device stores secret for future authentication

**Success criteria**: Device registers and receives approval.

---

### Step 9.3: Bidirectional Communication

**Goal**: Send commands from API to ESP32.

**What to do**:
1. API sends "ping" command
2. ESP32 responds with "pong"
3. Add status request/response

**Verification**:
- Ping/pong round trip works
- Status response includes version, uptime, etc.

**Success criteria**: API can query device status on demand.

---

## Phase 10: NFC → Playback Flow

### Step 10.1: Card Scan Event

**Goal**: ESP32 sends card scan to API via WebSocket.

**What to do**:
1. On NFC card detect, send `card_scanned` event
2. Include card UID in message
3. API logs received scan

**Message format**:
```json
{
  "event": "card_scanned",
  "uid": "04A32B1C5D8E00"
}
```

**Verification**:
- Tap card on ESP32
- API logs show card UID
- Event arrives within 200ms

**Success criteria**: Card tap appears in API logs immediately.

---

### Step 10.2: Play Command

**Goal**: API sends play command when card scanned.

**What to do**:
1. On card_scanned, lookup card mapping
2. If song found, send `play` command with stream URL
3. ESP32 logs received command

**Message format**:
```json
{
  "cmd": "play",
  "url": "http://server:3001/api/stream/123",
  "title": "Song Name"
}
```

**Verification**:
- Scan registered card
- API sends play command
- ESP32 logs the command

**Success criteria**: Card scan triggers play command with correct URL.

---

### Step 10.3: Unknown Card Handling

**Goal**: Handle unregistered cards gracefully.

**What to do**:
1. If card not in database, notify API
2. API can notify Control Plane for registration
3. ESP32 can play error sound (optional)

**Verification**:
- Unknown card doesn't crash
- Event logged
- Can trigger registration flow

**Success criteria**: Unknown cards handled gracefully.

---

## Phase 11: Audio Streaming

### Step 11.1: ESP32 HTTP Streaming

**Goal**: ESP32 streams audio from API.

**What to do**:
1. Receive play command with URL
2. Connect to URL with ESP32-audioI2S library
3. Stream and decode audio
4. Output to I2S/speaker

**Library**: `schreibfaul1/ESP32-audioI2S`

**Verification**:
- Audio plays from speaker
- No significant buffering delays
- Playback completes without errors

**Success criteria**: Tap card → music plays from speaker.

---

### Step 11.2: Playback Events

**Goal**: ESP32 reports playback status to API.

**What to do**:
1. Send `playback_started` when audio begins
2. Send `playback_finished` when complete
3. Send error events on failure

**Events**:
- `playback_started` - Audio began playing
- `playback_finished` - Audio completed
- `playback_paused` - Playback paused
- `playback_resumed` - Playback resumed
- `playback_error` - Error occurred

**Verification**:
- Events appear in API logs
- Timing matches actual playback
- Errors are reported

**Success criteria**: API logs track playback lifecycle.

---

## Phase 12: Playback Controls

### Step 12.1: Play/Pause

**Goal**: Button controls playback.

**What to do**:
1. Play button press sends command to command queue
2. Command handler pauses/resumes audio
3. Report state change to API

**Verification**:
- Press while playing: pauses
- Press while paused: resumes
- State reported correctly

**Success criteria**: Play/pause button works as expected.

---

### Step 12.2: Volume Control

**Goal**: Volume buttons adjust audio level.

**What to do**:
1. Volume up/down buttons adjust level (0-21 range)
2. Persist volume in NVS (survives reboot)
3. Report volume changes to API

**Verification**:
- Volume audibly changes
- Volume persists across reboot
- API receives volume events

**Success criteria**: Volume control works, persists across reboot.

---

### Step 12.3: Remote Commands

**Goal**: API can control playback remotely.

**What to do**:
1. API sends volume/pause/stop commands
2. ESP32 executes commands
3. State synchronizes

**Commands**:
```json
{"cmd": "pause"}
{"cmd": "resume"}
{"cmd": "stop"}
{"cmd": "volume", "level": 15}
{"cmd": "next"}
{"cmd": "prev"}
```

**Verification**:
- Send volume command: audio changes
- Send pause command: audio pauses
- Send stop command: audio stops

**Success criteria**: Full remote control via WebSocket.

---

## Phase 13: Playlist Support

### Step 13.1: Playlist Playback

**Goal**: ESP32 plays multiple songs in sequence.

**What to do**:
1. API sends playlist URLs in play command
2. ESP32 loads playlist into memory
3. Auto-advance to next song on finish

**Message format**:
```json
{
  "cmd": "play",
  "playlist": [
    "http://server/api/stream/1",
    "http://server/api/stream/2",
    "http://server/api/stream/3"
  ],
  "startIndex": 0
}
```

**Verification**:
- All songs play in order
- No gaps between songs
- Playback completes entire playlist

**Success criteria**: Multi-song playlist plays through.

---

### Step 13.2: Next/Previous

**Goal**: Skip buttons navigate playlist.

**What to do**:
1. Next button advances to next song
2. Previous button goes to previous song
3. Wrap or stop at boundaries (your choice)

**Verification**:
- Next works throughout playlist
- Previous works
- Track position reported to API

**Success criteria**: Navigate playlist with buttons.

---

## Phase 14: SD Card Caching

### Step 14.1: Cache Directory Structure

**Goal**: Create organized cache on SD card.

**What to do**:
1. Create `/cache` directory on mount
2. Create subdirectory per card UID
3. Store manifest file with track info

**Directory structure**:
```
/cache/
├── 04A32B1C5D8E00/
│   ├── manifest.json
│   ├── 001.mp3
│   └── 002.mp3
└── 04B21A3D7E9F00/
    └── ...
```

**Verification**:
- Directories create correctly
- Manifest JSON is valid
- Paths are correct length

**Success criteria**: Cache structure creates properly.

---

### Step 14.2: Cache Downloads

**Goal**: Download audio files to SD card.

**What to do**:
1. API sends cache command with URLs
2. ESP32 downloads files to SD
3. Verify integrity (file size, optional checksum)

**Command format**:
```json
{
  "cmd": "cache",
  "uid": "04A32B1C5D8E00",
  "tracks": [
    {"url": "http://server/api/stream/1", "filename": "001.mp3"},
    {"url": "http://server/api/stream/2", "filename": "002.mp3"}
  ]
}
```

**Verification**:
- Files download completely
- Files are playable
- Progress reported

**Success criteria**: Audio files cache to SD card.

---

### Step 14.3: Cache-First Playback

**Goal**: Play from cache when available.

**What to do**:
1. On card scan, check if cached
2. If cached, play from SD immediately
3. If not cached, stream from API
4. Report source (cache vs stream) to API

**Verification**:
- Cached card plays instantly (no network delay)
- Non-cached card streams normally
- Cache miss falls back gracefully

**Success criteria**: Cached cards play instantly, others stream.

---

## Phase 15: Sound Machine

### Step 15.1: Sound Machine Config Endpoint

**Goal**: API provides sound machine configuration.

**What to do**:
1. Add endpoint to get device's configured sound
2. Return stream URL for sound
3. Store sound files on server or database

**Endpoint**: `GET /api/soundmachine/config`

**Response**:
```json
{
  "soundName": "rain",
  "streamUrl": "http://server/api/soundmachine/stream/rain"
}
```

**Verification**:
- Config returns correct sound name
- Stream URL is valid and plays

**Success criteria**: API returns sound machine config.

---

### Step 15.2: Long Press Activation

**Goal**: Long press triggers sound machine.

**What to do**:
1. Detect 3+ second press on play button
2. Fetch config from API
3. Start looping audio playback

**Verification**:
- Long press triggers (short press doesn't)
- Audio loops continuously
- Different from normal playback

**Success criteria**: Long press starts looping ambient audio.

---

### Step 15.3: Sound Machine Deactivation

**Goal**: Exit sound machine mode.

**What to do**:
1. Short press on play button deactivates
2. Stops audio
3. Returns to normal mode

**Verification**:
- Single press stops sound machine
- Device returns to idle state
- Next card scan works normally

**Success criteria**: Clean exit from sound machine mode.

---

## Phase 16: OTA Updates

### Step 16.1: Version Check on Boot

**Goal**: ESP32 checks for updates on startup.

**What to do**:
1. On boot (after WiFi), fetch `/api/firmware/latest.json`
2. Compare versions
3. Log if update available

**Verification**:
- Version check completes
- Correctly identifies when update available
- Doesn't block boot on network failure

**Success criteria**: Boot logs show "Update available" or "Up to date".

---

### Step 16.2: Server-Triggered Update

**Goal**: API can trigger OTA update.

**What to do**:
1. API sends update command via WebSocket
2. ESP32 acknowledges and begins update
3. Progress reported back to API

**Command format**:
```json
{
  "cmd": "update",
  "url": "http://server/api/firmware/1.1.0.bin",
  "version": "1.1.0",
  "sha256": "abc123..."
}
```

**Verification**:
- Update command received
- Download begins
- Progress reported

**Success criteria**: API can initiate firmware update.

---

### Step 16.3: OTA Download and Flash

**Goal**: Download and apply firmware update.

**What to do**:
1. Download firmware binary to OTA partition
2. Verify SHA256 hash
3. Set boot partition and reboot

**Verification**:
- Download completes
- Hash verification passes
- Device boots new firmware
- Rollback works on bad firmware (built-in ESP32 feature)

**Critical**: Never skip hash verification. Always stop audio before updating.

**Success criteria**: Remote firmware update works end-to-end.

---

## Phase 17: Error Handling & Resilience

### Step 17.1: Graceful Degradation

**Goal**: Device works without network.

**What to do**:
1. If WiFi unavailable, skip WebSocket
2. If cached content available, allow playback
3. Retry network in background

**Verification**:
- Boot without WiFi: device starts
- Play cached card: works
- WiFi reconnects: WebSocket resumes

**Success criteria**: Offline playback works for cached content.

---

### Step 17.2: Error Recovery

**Goal**: Recover from component failures.

**What to do**:
1. NFC read error: retry with backoff
2. Audio stream error: retry or report
3. SD card error: disable caching, continue

**Verification**:
- Temporary errors recover
- Persistent errors reported
- Device doesn't hang or crash

**Success criteria**: Device recovers from transient failures.

---

### Step 17.3: Watchdog & Restart

**Goal**: Recover from hangs.

**What to do**:
1. Enable hardware watchdog
2. Implement restart combo (e.g., 5x volume down)
3. Log restart reasons

**Verification**:
- Stuck device restarts via watchdog
- Manual restart combo works
- Restart reason logged on boot

**Success criteria**: No permanent hangs.

---

## Final Integration Testing

### Full System Test Checklist

**ESP32 Hardware**:
- [ ] Device boots and prints version
- [ ] PSRAM detected
- [ ] Audio plays through speaker
- [ ] NFC reads cards reliably
- [ ] All 5 buttons work
- [ ] SD card mounts and read/writes

**Connectivity**:
- [ ] WiFi connects
- [ ] WebSocket connects to API
- [ ] Reconnects after disconnect

**Playback**:
- [ ] Card scan triggers playback
- [ ] Audio streams from API
- [ ] Volume control works
- [ ] Play/pause works
- [ ] Playlist plays through
- [ ] Next/previous navigate

**Caching**:
- [ ] SD card caching works
- [ ] Cached cards play instantly
- [ ] Cache-first with fallback to stream

**Sound Machine**:
- [ ] Long press activates
- [ ] Audio loops
- [ ] Short press deactivates

**OTA**:
- [ ] Version check works
- [ ] Update downloads
- [ ] Hash verifies
- [ ] Device reboots to new firmware

**Control Plane**:
- [ ] Library shows songs
- [ ] Can upload songs
- [ ] Can create playlists
- [ ] Can register cards
- [ ] Devices show online/offline
- [ ] Can approve devices
- [ ] Can send playback commands
- [ ] Download queue works
- [ ] Podcasts work
- [ ] Firmware upload works

---

## Appendix A: Troubleshooting

### No Serial Output
- Check USB cable (data, not charge-only)
- Verify USB CDC enabled in build flags
- Try different USB port

### NFC Not Detecting
- Verify I2C mode selected on module
- Check I2C address with scanner
- Try adding pull-up resistors

### Audio Crackling/Noise
- Add/improve power filtering capacitors
- Check ground connections
- Reduce software volume

### WiFi Won't Connect
- Verify credentials
- Check 2.4GHz vs 5GHz (ESP32 is 2.4GHz only)
- Reduce distance to router for testing

### SD Card Mount Fails
- Try different SD card
- Reformat as FAT32
- Check wiring, especially CS pin

### WebSocket Won't Connect
- Verify API is running
- Check firewall/port
- Verify URL and port in secrets.h

---

## Appendix B: Component Datasheets

- ESP32-S3 Technical Reference: https://www.espressif.com/en/products/socs/esp32-s3
- MAX98357A Datasheet: https://www.analog.com/en/products/max98357a.html
- PN532 User Manual: https://www.nxp.com/docs/en/user-guide/141520.pdf

---

## Appendix C: Library References

### ESP32 Libraries

| Library | Purpose | Repository |
|---------|---------|------------|
| ESP32-audioI2S | Audio decode/playback | github.com/schreibfaul1/ESP32-audioI2S |
| Adafruit PN532 | NFC reader | github.com/adafruit/Adafruit-PN532 |
| Button2 | Button handling | github.com/LennartHennworst/Button2 |
| WebSockets | WebSocket client | github.com/Links2004/arduinoWebSockets |
| ArduinoJson | JSON parsing | github.com/bblanchon/ArduinoJson |

### API Service Libraries

| Library | Purpose | Repository |
|---------|---------|------------|
| Hono | Web framework | hono.dev |
| Drizzle ORM | Database ORM | orm.drizzle.team |
| better-sqlite3 | SQLite driver | github.com/WiseLibs/better-sqlite3 |
| ws | WebSocket server | github.com/websockets/ws |
| music-metadata | Audio metadata | github.com/borewit/music-metadata |

### Control Plane Libraries

| Library | Purpose | Repository |
|---------|---------|------------|
| TanStack Start | Full-stack React | tanstack.com/start |
| TanStack Router | File-based routing | tanstack.com/router |
| TanStack Query | Data fetching | tanstack.com/query |
| Tailwind CSS | Styling | tailwindcss.com |
| Radix UI | Components | radix-ui.com |
| dnd-kit | Drag and drop | dndkit.com |

### External Tools (for downloads)

| Tool | Purpose | Notes |
|------|---------|-------|
| yt-dlp | Audio download | Python CLI tool |
| ytmusicapi | YouTube Music API | Python library |
| ffmpeg | Audio conversion | For format conversion |
