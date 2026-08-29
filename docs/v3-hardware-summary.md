# MusicBox v3 — Hardware Summary for PCB/Enclosure Design

## What It Is
A standalone NFC-based music player for kids. Tap an NFC card → plays a song or playlist. Physical buttons for playback control. Audio through a built-in speaker. Connects to a home server (self-hosted) over WiFi for streaming and management. **USB-C powered, no battery.**

---

## Current Hardware (v1/v2 — breadboard/devkit)

| Component | Part | Interface |
|-----------|------|-----------|
| MCU | ESP32-S3-DevKitC-1-N16R8 | — |
| NFC reader | PN532 V3 | I2C |
| Audio amp | MAX98357A | I2S |
| Speaker | 4Ω or 8Ω, 3W | — |
| SD card | MicroSD SPI module | SPI |
| Buttons | 5× momentary tactile switches | GPIO (active low, internal pull-ups) |
| Power filtering | 100µF electrolytic + 0.1µF ceramic | On MAX98357A VIN |

## Current Pin Assignments

```
I2S (MAX98357A):      GPIO4=BCLK, GPIO5=LRC, GPIO6=DIN
I2C (PN532):          GPIO8=SDA, GPIO9=SCL
SPI (SD card):        GPIO38=CLK, GPIO39=MOSI, GPIO40=MISO, GPIO41=CS
Buttons (active low): GPIO10=Play/Pause, GPIO11=Vol Up, GPIO12=Vol Down,
                      GPIO13=Next, GPIO14=Prev
Reserved:             GPIO19/20=USB, GPIO26-32=internal flash, GPIO35-37=PSRAM
```

## Power
- USB-C in → 5V rail
- MAX98357A: 5V VIN
- ESP32-S3 + PN532: 3.3V (via onboard LDO)
- SD card module: 5V (has onboard regulator)

---

## Firmware Architecture (relevant to hardware decisions)

- **MCU variant:** ESP32-S3-N16R8 — 16MB flash, 8MB octal PSRAM. PSRAM used for audio buffering.
- **Audio:** `ESP32-audioI2S` library. Single I2S stream. HTTP streaming from server or local SD card playback. 50-track queue. Sound machine mode (looping ambient audio).
- **Communication:** MQTT over WiFi (PubSubClient). Mosquitto broker on the server.
- **Provisioning:** WiFiManager captive portal — device broadcasts `MusicBox-Setup` AP on first boot, user configures WiFi + server URL via browser.
- **OTA:** Server-triggered over HTTP, SHA256 verified.
- **Storage:** SD card caches streamed audio files (cache-first playback). Also stores system sound files (startup chime, card scan sound, error sound).
- **NFC:** PN532 in I2C mode. Reads ISO14443A cards (MIFARE, NTAG). 1.5s debounce window.
- **Buttons:** Button2 library, software debouncing. Play/pause (with 1s long-press for sound machine), vol up/down, next, prev. Vol up + vol down held = restart (2s) or factory reset (5s).

---

## Known Hardware Pain Points (from v1/v2)

1. **Button responsiveness** — Software debouncing in the main loop competes with audio/WiFi tasks. Options explored:
   - RC hardware debouncing (10kΩ + 100nF per button) — cheap, removes need for long software debounce window
   - MCP23017 I2C GPIO expander — interrupt-driven, shares I2C bus (PN532 is at 0x24, MCP23017 at 0x20–0x27)
   - Dedicated button MCU (ATtiny, RP2040) — fully decoupled from ESP32 main loop

2. **No audio mixing** — `ESP32-audioI2S` owns the I2S peripheral exclusively. Can't overlay a chime on playing music without rework. Options explored:
   - Piezo buzzer on GPIO via LEDC PWM — independent audio path, no mixing, sounds electronic
   - Second MAX98357A on I2S1 + passive resistor summer into speaker — true hardware mixing
   - Software mixing via minimp3 + manual I2S DMA — full control, significant rewrite

3. **SD card** — External SPI module. Integrated directly on PCB would be cleaner; SDMMC 4-bit mode is also an option (faster, frees SPI bus).

---

## v3 Goals

- Custom PCB (no breadboard modules)
- Custom enclosure
- USB-C powered (wall power only, no battery)
- Better button responsiveness
- Chime overlay on music
- Integrated SD card on PCB
- Potentially: rotary encoder for volume, integrated NFC antenna

---

## Open Hardware Questions for v3

- Stick with ESP32-S3 or different MCU?
- SD card: SPI vs. SDMMC 4-bit on PCB?
- Button approach: RC debouncing only, MCP23017, or dedicated MCU?
- Audio mixing: second I2S amp + resistor summer, piezo for chimes, or software mixing?
- Volume UX: two buttons or rotary encoder?
- NFC antenna: keep PN532 module or integrate antenna on PCB?
