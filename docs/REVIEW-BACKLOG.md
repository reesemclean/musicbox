# Review Backlog — 2026-09-28

Findings from a full read-through of the server (`packages/web`) and firmware
(`packages/esp32`) against [`SYSTEM-BEHAVIOR-SPEC.md`](./SYSTEM-BEHAVIOR-SPEC.md).
Found by reading the code, not by running it — tests were not run for this
review. Items marked *verify* need checking on real hardware first.

Same rule as [`IMPLEMENTATION-BACKLOG.md`](./IMPLEMENTATION-BACKLOG.md): when an
item is done, delete it rather than checking it off. Items that are real spec
divergences can move there once confirmed.

---

## Bugs — high impact

- [ ] **Podcast refresh re-downloads and deletes old episodes every cycle**
  (`services/podcastService.ts` `refreshFeed`). "New" means "any feed item
  whose GUID isn't stored", capped at `retentionCount`. Episodes that retention
  already removed are no longer stored, so the next refresh treats the
  next-oldest ones as new, downloads and transcodes them, and
  `cleanupOldEpisodes` deletes them again. With retention 3, that's three full
  episodes fetched and thrown away per feed every 6h. Fix: only accept items
  newer than the newest stored episode, or keep a record of GUIDs already seen.

- [ ] **Podcast downloads can fail silently or stop all future refreshes**
  (`podcastService.ts` `downloadEpisodeById`). `curl -L` has no `-f` and no
  timeout:
  - An HTTP 404/500 saves the error page as `.mp3` and marks the episode
    `complete`.
  - A connection that stalls never returns, so the scheduler's `running` flag
    stays set and no feed refreshes again until a restart.

  Also, an invalid `pubDate` makes `new Date(...).toISOString()` throw, which
  aborts the refresh partway through.

- [ ] **A failed or interrupted episode never gets downloaded**
  (`podcastService.ts`). Its GUID is already stored, so later refreshes skip
  it, and `getLatestEpisode` won't pick it — the card keeps playing an older
  episode. The same happens to anything left `pending`/`downloading` when the
  server restarts.

- [ ] **M4A podcasts send the wrong Content-Type to the device**
  (`podcastService.ts`, `routes/api/media/stream/$id.ts`). The episode's
  `mimeType` comes from the URL (`audio/mp4`), but what gets streamed is the
  MP3 transcode (`normalizedPath`). The stream route sends `item.mimeType`, and
  ESP32-audioI2S picks its codec from that header. Upload already handles this
  correctly by storing `CANONICAL_MIME`.

- [ ] **A failed OTA update isn't reported, and the download can drop data or
  hang** (`main.cpp` `onOta`, `ota_updater.cpp` `ota_start_update`).
  `ota_on_complete` is never registered, so a failure isn't reported to the
  server (spec §7, §10). The download loop also has two problems of its own:
  - It exits as soon as `http.connected()` goes false, dropping data still
    buffered in the socket. `flash_store.cpp` `download_to` already fixed
    exactly this and notes that multi-MB downloads hit it reliably.
  - It has no stall timeout and resets the watchdog on every pass, so a
    connection that goes quiet hangs the device indefinitely.

- [ ] **A card left on the reader probably re-triggers every 1.5s** — *verify*
  (`nfc_reader.cpp` `attempt_read`). `last_scan_time` only updates when a scan
  fires, so while the card stays present the debounce window runs out and the
  scan fires again (spec §5). Fix: refresh the timestamp on every read of the
  same card, so a re-trigger needs the card to be absent for the window.

## Bugs — medium

- [ ] **Rejected or unknown devices still get card scans answered**
  (`mqttService.ts` `handleCardScanned`, spec §1.3). No device-status check.
  Rejecting a device also sends nothing to it, so NFC stays enabled there.

- [ ] **Album downloads leave out tracks already in the library**
  (`downloadService.ts` `queueDownload`). It returns early for songs already
  downloaded or already queued, so those tracks are never linked into the new
  album playlist (spec §11.2).

- [ ] **Downloads left `pending`/`downloading` across a server restart get
  stuck** (`downloadService.ts`, `services/startup.ts`). Nothing resumes them at
  startup, and `retryDownload` only accepts `failed`, so they can only be
  removed.

- [ ] **System sounds can be deleted through the API** (`server/media.ts`
  `deleteMedia`). No check for `metadata.system`, which spec §11.4 requires.

- [ ] **A sound-machine volume change is only saved to NVS when a download
  happens** (`flash_store.cpp` `flash_set_soundmachine_config`). After an
  offline reboot the device uses the old volume (spec §3.8).

- [ ] **OTA URLs use `API_BASE_URL`, unlike every other device-facing URL**
  (`server/devices.ts` `triggerDeviceUpdate`). The others prefer
  `STREAM_BASE_URL`, so OTA breaks behind the reverse proxy described in
  spec §8.4b.

- [ ] **The device doesn't re-send playback status after connecting to MQTT**
  (`mqtt_client.cpp` `mqtt_connect`, spec §8.2). After a server restart,
  devices show no or stale status until something changes.

## Bugs — low

Three edge cases left by the skip-tracking and OTA fixes (#9), found by its
final review. Each needs a rare combination, so they were recorded here rather
than fixed in another round.

- [ ] **A playlist edited between a play and the device's request is followed
  in the wrong order** (`mqttService.ts` `issuePlay` callers,
  `routes/api/playlists/stream/$id.ts`). The server stores the track order
  when it sends a play; the endpoint reads the playlist again when the device
  connects — after the read cue, or after each earlier stream in a skip burst.
  An edit in that gap leaves the server following an order the device isn't
  playing (spec §3.6 says it follows the order the device plays), and a skip's
  `?from=` can start on the wrong track or past the end (416). Fix: have the
  endpoint serve the order the server planned — same process, so a plan id in
  the URL would do — instead of re-querying.
- [ ] **After a mid-listen edit, a skip can pick the wrong copy of a duplicated
  track** (`lib/skip.ts` `currentIndexOf`). The playing track is mapped onto
  the edited playlist by its index, else the nearest copy (ties to the
  earlier). An insert or removal above a duplicate can land on the other copy:
  stream [10,30,20,30,40] on the second 30, two tracks added at the top, and
  Next replays 20 and 30. Fix: map by `playlist_media` row id while the row
  still exists (removals keep ids; reorders re-insert every row), else score
  copies by matching neighbours.
- [ ] **A card scanned just before an OTA can play after the update fails**
  (`main.cpp` `onOta`). If the `ota` command lands between a scan's
  `card_scanned` and the server's `play`, the play waits in the socket while
  the update runs, and after a fast failure it starts the card well after it
  was presented. Separately, a read cued just before the update but not yet
  handed over is discarded, leaving a cue with nothing after it. Fix: ignore
  card-originated plays issued before the update, and play the error cue if a
  failed update discarded a read.

- [ ] **A card mapped to nothing gets no reply** (`mqttService.ts`
  `handleCardScanned`). The user hears the error cue only after the 3s
  timeout, instead of an immediate `error_sound`.
- [ ] **Upload file extension isn't sanitized** (`routes/api/media/upload.ts`).
  A crafted filename can write outside `data/songs`. Cheap to fix even on a
  trusted LAN.
- [ ] **Playlist edits can go wrong** (`server/playlists.ts`).
  `reorderPlaylist` deletes and re-inserts without a transaction, so a failure
  partway empties the playlist; `removeMediaFromPlaylist` removes every copy of
  a track that appears more than once.
- [ ] **Skip elapsed time includes time spent paused** (`audio_player.cpp`
  `audio_get_elapsed_sec`), so "previous" after a pause usually restarts the
  track instead (spec §3.6).
- [ ] **Two refreshes of the same feed can overlap** (manual, scheduled, or
  `addPodcastFeed`) and insert duplicate episode rows.
- [ ] **Dead code:** `ota_check_for_update`; `/api/cards/lookup` (leftover from
  device-side lookup, also referenced in `esp32/src/generated/api_types.h`);
  the server's `EventEmitter` events, which nothing listens to.

---

## Feature opportunities

- [ ] **Play and skip from the Control Plane** — "Play on device" for a song or
  playlist, plus Next/Previous in the remote control. Spec §3.2 already
  describes a UI skip as the server sending `play` directly.
- [ ] **Report volume in `playback_status`** — the UI volume slider currently
  guesses, and the sound machine permanently changes the device's volume
  without the server knowing.
- [ ] **Resume position for podcasts** — stopping and rescanning a long episode
  starts from zero. The stream endpoint already supports Range requests; the
  device would need to report position (it currently always sends 0).
- [ ] **Upload custom sound-machine sounds** — encode to 48 kbps mono with the
  loop crossfade from spec §4.1, instead of only offering seeded files.
- [ ] **Edit an existing card** (mapping or volume) instead of delete and
  recreate.
- [ ] **Download worker with a concurrency limit** — an album download currently
  starts every yt-dlp and ffmpeg process at once. The worker could also resume
  stuck downloads at startup.
- [ ] **Show OTA progress and results in the UI**, over MQTT.
- [ ] **Small extras:** shuffle for playlist cards; a "next unplayed episode"
  mode for podcast cards; a startup warning when `API_BASE_URL` is left at its
  stale default.
