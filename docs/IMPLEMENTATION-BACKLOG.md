# MusicBox Implementation Backlog

Tracks where the current implementation diverges from
[`SYSTEM-BEHAVIOR-SPEC.md`](./SYSTEM-BEHAVIOR-SPEC.md), and the work needed to
close the gap.

**The spec describes how the system should behave. This document tracks what's
left to build.** When an item here is done, check it off — the spec itself
never needs editing, because it already describes the finished state.

Phase numbering matches the implementation plan agreed 2026-08-02.

---

## Phase 1 — Independent fixes

No dependencies on each other or on later phases. Safe to do in any order.

- [x] **1.1 — OTA hardening** (spec §7)
  `ota_updater.cpp` runs a blocking download loop on the task that owns the 30s
  watchdog, never calling `esp_task_wdt_reset()`. It works today only because a
  LAN-speed download of the current image finishes inside the budget; a larger
  image or slower link would panic mid-update. Add the reset inside the loop.
  Also: the pre-OTA stop (`main.cpp:151-162`) issues an async `audio_stop()` and
  waits a fixed `delay(500)` without confirming the audio task reached `IDLE` —
  spec requires confirmation.

- [x] **1.2 — Volume clamped to half its range** (spec §3.7)
  `handle_set_volume` and `audio_set_max_volume` both clamp to `21` before
  applying `maxVolume`, despite `setVolumeSteps(42)` and a 0–42 UI/schema. The
  device cannot exceed half its usable loudness. Remove both clamps; correct the
  stale `0-21` comments on `cards.volume` and `devices.soundMachineVolume` in
  `db/schema.ts`.

- [x] **1.3 — MQTT client used from two cores** (spec §2.2)
  `emit_status()` → `onPlaybackStatus` → `mqtt_publish_playback_status()` runs on
  Core 0, while `mqttClient.loop()` runs on Core 1, against a non-thread-safe
  client sharing one `WiFiClient`. Causes intermittent frame corruption and
  broker disconnects. Route status publishes through a queue drained on Core 1 —
  same deferred-dispatch pattern already used in `wifi_manager.cpp`.

- [x] **1.4 — Media stream endpoint hardening** (spec §8.4)
  Three issues in `routes/api/media/stream/$id.ts`:
  - `nodeStreamToWebStream` enqueues every `data` chunk regardless of consumer
    readiness — a slow device buffers the whole file in server RAM.
  - Range parsing doesn't validate `start`/`end` bounds before computing chunk
    size; out-of-range should be `416`.
  - An empty `filePath` (a podcast episode still `pending`/`downloading`)
    resolves to `DATA_DIR` itself, passes `existsSync`/`statSync`, and then
    throws `EISDIR` mid-response *after* headers with a bogus `Content-Length`
    are already sent. The device gets a truncated, non-EOF-terminated stream.

- [x] **1.5 — Podcast cards resolve to the wrong feed** (spec §11.3)
  Both `mqttService.handleCardScanned` and `syncCardsToDevice` independently
  select "newest `type='podcast'` row in the library" — no `feedId` filter, no
  download-status check. A podcast card plays whichever episode downloaded most
  recently *anywhere*, and can select one whose audio doesn't exist yet.
  `podcastService.getLatestEpisode(feedId)` already implements the correct
  per-feed, publish-date-ordered selection; both call sites should use it. Add a
  download-status filter to that function.

  *Implemented with two deliberate refinements:* (a) there were three call
  sites, not two — `pushCardUpdate` had the same query; (b) a podcast card with
  no playable episode now triggers `error_sound` rather than failing silently,
  matching how an unknown card already behaves. Per spec §3.3 that also returns
  playback to `IDLE`, so scanning such a card interrupts what's playing — the
  same as scanning any card that *does* resolve.

- [x] **1.6 — YouTube ingestion: dedup and orphaned partials** (spec §11.2)
  `queueDownload` dedups only against `downloadQueue`; since successful rows are
  deleted, re-requesting an already-downloaded `videoId` silently creates a
  duplicate `media` row. Check `media.metadata.youtubeVideoId` too.
  Separately, `processDownload`'s failure branches never `unlink(outputPath)`,
  and each retry uses a fresh UUID — repeated failures accumulate orphaned
  partial files in `data/songs/`.

- [x] **1.7 — `lastSeen` not refreshed on reconnect** (spec §8.2)
  `handleDeviceStatus` updates `lastSeen` only on `online: false`. A device that
  reconnects but hasn't yet sent a playback event still reads as offline in the
  UI, disabling its controls.

---

## Phase 2 — Playlist stream prototype (gates Phases 3–4)

- [x] **2.1 — Validate continuous playlist streaming** (spec §3.5, §3.6, §8.5)
  **Server side validated** — see
  [`decisions/2026-08-02-playlist-streaming.md`](./decisions/2026-08-02-playlist-streaming.md).
  Frame-level concatenation is sample-exact; ICY metadata round-trips with the
  recovered audio byte-identical to direct concatenation; announce lag is
  sub-second. Four constraints came out of it and are now in the spec: strip
  ID3/Xing frames, normalize sample rate at ingest, always send
  `Content-Length` (never chunked), and cache per-track extracted-audio length.

- [ ] **2.2 — Confirm on hardware** (spec §3.5)
  The prototype proves the server emits a correct stream; it cannot prove the
  device consumes it. On real hardware, confirm: the `streamtitle` event fires
  mid-stream carrying the injected `mediaId`; the decoder crosses a track
  boundary without an audible artifact; real time-to-first-audio over WiFi.
  Fallback if the boundary is audible: server-side transcoding — heavier, but
  no change to the device-facing contract. Can be done alongside Phase 4.

---

## Phase 3 — Server

- [x] **3.0 — Record extracted-audio length at ingest** (spec §8.5, §11.1)
  New prerequisite from Phase 2. §8.5 must send an exact `Content-Length`, which
  depends on every track's post-strip audio length; without this cached, the
  endpoint would read the whole playlist before sending byte one. Add the column
  (plus frame-derived duration), populate it on upload and yt-dlp ingest, and
  backfill existing rows. Parsing costs ~4ms for a 6.4MB file, so backfill is
  cheap.

- [x] **3.1 — Normalize media format at ingest** (spec §11.1)
  `api/media/upload.ts` accepts m4a/flac/wav/ogg/webm and stores them unchanged.
  The playlist stream requires format consistency — normalize to the same mono
  MP3 the yt-dlp path produces. Sample rate matters most. Note the library is
  *already* inconsistent (song: stereo/238k, sound machine: stereo/192k, system
  sounds: mono/128k), so this needs a backfill pass too, not just new uploads.

- [ ] **3.2 — Playlist continuous-stream endpoint** (spec §8.5)
  New route at `GET /api/playlists/stream/:id` serving a whole playlist as one
  response with ICY metadata at track boundaries. The prototype's
  frame-extraction module was written to be lifted directly into this.

- [ ] **3.3 — MQTT command layer rework** (spec §6.1, §6.2)
  Remove `queue`, `sync_cards`, `card_update`, `card_delete`, `clear_cache`. Add
  `skip` and `soundmachine_config`. Card resolution emits a single `play`
  carrying either a media or playlist stream URL. The DB resolution logic in
  `handleCardScanned` is correct and should be kept.

- [ ] **3.4 — Delete card-sync machinery** (spec §5, §12)
  `syncCardsToDevice`, `pushCardUpdate`, `pushCardDelete`, and
  `pushCardsForPlaylist` (`server/playlists.ts`) exist solely to maintain a
  device-side card cache that no longer exists. Remove them and all call sites
  in `cards.ts`, `devices.ts`, `playlists.ts`.

- [ ] **3.5 — Push sound-machine config on change** (spec §3.8)
  When `soundMachineSound`/`soundMachineVolume` change in `updateDevice`, push
  `soundmachine_config` so the device can store it locally. The existing
  `/api/soundmachine/config/$mac` route already models this payload shape.

- [ ] **3.6 — Scheduled podcast feed refresh** (spec §11.3)
  `refreshAllFeeds()` exists but only runs from a UI button. Nothing in
  `startup.ts` schedules it, so subscriptions only update when someone clicks.

- [ ] **3.7 — Transition shim** (cutover only, not a spec requirement)
  Keep the `soundmachine_request` handler until all devices run new firmware, so
  an un-updated device's long-press still works during cutover. Delete after.

---

## Phase 4 — ESP32 firmware

- [ ] **4.1 — Delete SD and card-cache modules** (spec §4, §5)
  `sd_cache.cpp/h` (contains the only `SD.begin()`) and `card_cache.cpp/h` (pure
  RAM, but the device no longer holds card mappings at all).

- [ ] **4.2 — New local flash store** (spec §4, §3.8)
  LittleFS for system sounds and the single sound-machine file; NVS for
  sound-machine config. Written fresh — `sd_cache`'s eviction and download-queue
  machinery doesn't map onto a scope this small. Follow `device_config.cpp`'s
  Preferences pattern for NVS.

- [ ] **4.3 — Rewrite `audio_player`** (spec §3.1, §3.3, §3.4, §3.5)
  Consolidates four spec divergences that share one root cause:
  - **Mode tracking is three independent booleans** (`playing_system_sound`,
    `soundmachine_mode`, implicit-normal) rather than one `mode` value. This is
    why the two safer paths got a track-end recovery that normal playback never
    did.
  - **Liveness check missing for normal playback.** Only system-sound and
    soundmachine implement the `!isRunning()` fallback; normal playback relies
    on the EOF callback alone, which HTTP streams don't reliably deliver. With
    no local content to fall back to, a hang is now a fully silent dead end.
    *Highest-value single fix in the spec.*
  - **Sound machine mode never exits on `play`.** `handle_play_url` /
    `handle_play_sd_file` don't clear `soundmachine_mode`, so a card scanned
    during sound machine plays once and then reverts to looping the sound
    machine. Note `main.cpp` also keeps a second Core-1 copy
    (`sound_machine_active`) — a single source of truth is required.
  - **No device-side queue.** Playlists arrive as one stream URL.

- [ ] **4.4 — Rewrite `main.cpp` wiring** (spec §5, §3.8)
  Read cue fires on UID capture *before* resolution; `onCardScanned` becomes
  publish-and-wait; `onPlayLongPress` reads local config instead of asking the
  server; new skip publishing; resolution-timeout cue. Rewrite together with 4.3
  — they are one contract.

- [ ] **4.5 — `mqtt_client.cpp` command/event set** (spec §6)
  Update to the new contract. Transport layer itself is sound.

---

## Deferred — not planned

- **Security & access control** (spec §13)
  No authentication anywhere: every server function, the whole control-plane UI,
  and the MQTT broker (`allow_anonymous true`) are open to anyone on the network.
  `devices.secret` is generated but never verified. `docs/server-auth-plan.md`
  describes a plan that is not implemented.

  **Consciously deferred.** Accepted risk for a trusted home LAN. Revisit before
  any deployment beyond a single household, or before exposing the server
  remotely. Web UI auth (that plan's Phase 1) is independent of all firmware work
  and could be picked up at any time.
