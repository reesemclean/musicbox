# MusicBox System Behavior Specification

## Purpose

This document specifies how the MusicBox system — ESP32 device firmware, MQTT
broker, and web control plane — is expected to behave. It is normative: where
it conflicts with the current implementation, the implementation is wrong,
not the spec. It exists to drive bug fixes and to give a rewrite (if one
happens) a target that isn't just "whatever the old code did."

**Status:** target architecture, agreed 2026-08-02. Describes the finished
state, not what the code does today.

Where the current implementation diverges from this document, the divergence is
tracked in [`IMPLEMENTATION-BACKLOG.md`](./IMPLEMENTATION-BACKLOG.md) — not
here. This document should not need editing as the code catches up to it.

A small number of sections are marked **⚠ Provisional**: their design depends on
a prototype that hasn't been completed yet. Treat those as intent, not settled
requirement, until the prototype resolves them.

### Guiding Principle

**State and logic live on the server; the device stays as thin as the
premise (reliable home WiFi, a server that's normally reachable) allows.**
Where earlier iterations of this system duplicated state on the device for
resilience or latency — a play queue, an SD-backed media cache, a card
UID→content mapping — this spec pushes that state back to Server and
accepts the small, consistent cost (a network round-trip) in exchange for
removing an entire class of device/server state-synchronization bugs. The
device keeps only what genuinely cannot depend on the network working at a
given instant: system sounds, the sound-machine sound and its
configuration, and NFC read detection itself. When extending this spec,
default to resolving new state on the server rather than caching it on the
device, unless there's a specific reason (like the sound machine) that the
device must be able to act without asking first.

### Components

- **Device** — ESP32 firmware (`packages/esp32`). Owns audio playback, NFC
  reading, a small amount of local flash storage (system sounds and the
  sound-machine sound only — no SD card, see §4), and is the sole source of
  truth for its own playback state.
- **Broker** — MQTT broker. Pure message transport; holds no state of its
  own beyond retained topics.
- **Server** — Web app (`packages/web`). TanStack Start app serving the
  control-plane UI, the media library API/DB, and bridging MQTT.
- **Control Plane UI** — Browser app served by Server. Sends commands to
  devices and displays their reported state. Never controls a device
  directly — always through Server → MQTT.

---

## 1. Device Lifecycle

### 1.1 Provisioning

A device with no stored WiFi SSID or API base URL is **unprovisioned**. On
boot, an unprovisioned device MUST start a captive portal (SSID
`MusicBox-Setup`) and MUST NOT attempt normal operation until provisioned.

- The portal MUST time out after a bounded period (target: 5 minutes) and
  restart the device to retry, rather than hang indefinitely.
- On successful submission, the device MUST persist WiFi credentials and the
  server URL to non-volatile storage and restart.
- Provisioning MUST NOT require the companion server to be reachable during
  the portal session — only WiFi credentials and a URL are collected.

### 1.2 Boot Sequence (provisioned device)

1. Load config from NVS.
2. Enable the task watchdog before any long-running operation.
3. Initialize audio, buttons, NFC.
4. If the device was **previously approved**, enable NFC scanning
   immediately. Reading a card works without WiFi (see §1.4), but resolving
   *and playing* what it maps to requires the server to be reachable — there
   is no local content to fall back to for library media.
5. Begin WiFi connection **non-blockingly**. The device MUST become usable
   (NFC reads registering, sound machine available) within a few seconds of
   power-on regardless of WiFi state.
6. On WiFi connect: discover the MQTT broker via `GET /api/device/config`,
   falling back to the last-known broker cached in NVS if the server is
   unreachable. Connect to MQTT once a broker is known.
7. On MQTT connect: publish registration (`musicbox/register`), subscribe to
   the device's command topic, and publish an online status (retained).

### 1.3 Device Registration & Approval

- On registration, Server MUST create a `pending` device record if the MAC
  is unknown, or update `lastSeen`/`firmwareVersion`/`lastIp` if known.
- A `pending` or `rejected` device MUST NOT receive config or playback
  commands, and MUST NOT be controllable from the UI.
- Approving a device (`pending` → `approved`) MUST cause Server to push a
  `config` command with the device's `maxVolume`. There is nothing else to
  push at approval time — cards are resolved per-scan against the server's
  database (§5), not synced to the device (§12).
- Once `device_ready` (WiFi + MQTT + approved) is reached for the first time
  in a boot cycle, the device MUST play its startup sound exactly once.

### 1.4 Offline Mode

The device has no bulk local storage (§4 covers what little local content
remains: system sounds and the sound-machine sound). This is a deliberate
trade, made on the premise that these devices live on reliable home WiFi:
regular library playback (songs/playlists/podcasts) requires the server to
be reachable, full stop. What MUST still work without WiFi or server
connectivity:

- NFC reads are still detected and still produce the immediate read cue
  (§5) — the device doesn't need the network to know a card touched the
  reader.
- The sound machine MUST work fully offline. This requires more than just
  having the file on flash: the device MUST also hold its own local copy of
  *which* sound and volume are currently configured, so a long-press never
  has to ask the server (§3.8). A request/response flow at long-press time
  would be a live network dependency disguised as a local feature.
- System sounds (startup, read cue, error) MUST work fully offline, for the
  same reason.

What does NOT work offline: resolving what a card maps to, and playing any
library content. A card read while the server is unreachable produces the
read cue and nothing further — see §5 for the distinct feedback that case
should give versus a normal read-then-play sequence. This is the accepted
cost of dropping local caching; it should not regress silently into "cards
don't do anything and there's no explanation" — the read cue plus a
timeout-triggered error cue (§5) is what keeps it from being a silent
failure.

### 1.5 Restart & Factory Reset

- Holding Vol-Up + Vol-Down and releasing after ≥2s MUST restart the device.
- Holding Vol-Up + Vol-Down for ≥5s MUST factory-reset (clear NVS, restart
  into the captive portal) without waiting for release.
- These MUST work regardless of playback or connectivity state.

---

## 2. Connectivity

### 2.1 WiFi

- Connection attempts MUST NOT block device startup beyond a short grace
  window (current target: 3s). The device continues booting whether or not
  WiFi has connected by then.
- On disconnect, reconnection MUST use exponential backoff (target: 1s
  initial, doubling, capped at 30s) to avoid hammering the AP.
- WiFi event callbacks MUST NOT run application logic directly inside the
  WiFi event task (small stack); they set flags and dispatch from the main
  loop.

### 2.2 MQTT

- Topics are per-device, keyed by MAC without colons:
  `musicbox/devices/<MAC>/events` (device → server),
  `musicbox/devices/<MAC>/commands` (server → device),
  `musicbox/devices/<MAC>/status` (retained online/offline).
- The device connection MUST set a retained Last-Will-and-Testament of
  `{"online": false}` on the status topic, so Server can detect ungraceful
  disconnects without a heartbeat protocol.
- On connect, the device publishes `{"online": true}` (retained) to the
  status topic before doing anything else.
- Control commands (play/pause/resume/stop/skip/volume/ota/config/
  soundmachine_config) are published and subscribed at **QoS 1** —
  at-least-once delivery, since a dropped control command is a user-visible
  failure.
- Telemetry events (playback_status, card_scanned, device_logs) are QoS 0 —
  best-effort is acceptable since they're either frequently repeated
  (status) or not safety-critical (logs).
- Reconnection MUST use a bounded retry interval (target: 5s) and MUST NOT
  block other device responsibilities (audio, NFC, buttons) while waiting.
- **All MQTT client calls (publish, subscribe, loop) MUST happen from a
  single task/core.** MQTT client libraries used here are not thread-safe.

---

## 3. Audio Playback

### 3.1 States vs. Modes

Playback has one **state** — `IDLE`, `PLAYING`, `PAUSED` — describing
whether audio is flowing. Orthogonal to state, playback has one active
**source mode** at a time:

- `NORMAL` — streamed media (a song, a podcast episode, or a whole playlist
  as one continuous stream — see 3.5) from the library, played directly from
  the server. Never touches local storage.
- `SYSTEM_SOUND` — a short fixed local clip (startup, **read cue**, error).
  Always plays from local flash (§4); never streamed. The read cue is the
  immediate feedback fired the instant an NFC UID is captured (§5) — it is
  a system sound like any other, not a separate mechanism.
- `SOUNDMACHINE` — a single track that loops until explicitly stopped.
  Always plays from local flash (§4, §3.8); never streamed.

A device is always in exactly one mode, and the mode determines how a
track-end event is handled (see 3.4) and what commands are meaningful (see
3.3).

The mode is a single value, not a set of independent flags. Every code path
that changes it changes exactly one thing, so it is impossible to be in two
modes at once or to leave a stale mode set after switching.

### 3.2 Commands

| Command | Meaning |
|---|---|
| `play(url, mediaId)` | Replace everything: stop current audio, play immediately. `url` may point at a single item (song, podcast episode) or a server-generated continuous multi-track stream (a playlist) — the device treats both identically, as one connection (see 3.5). |
| `pause` | Pause current audio. No-op if not `PLAYING`. |
| `resume` | Resume paused audio. No-op if not `PAUSED`. |
| `stop` | Stop audio entirely, return to `IDLE`. |
| `skip_next` / `skip_prev` | Request a track change within the current playlist stream. See 3.6 — this is no longer a purely local operation. |
| `volume(level)` | Set output volume (0–42, see 3.7). |
| `soundmachine(url, name, volume)` | Enter soundmachine mode with the given track, played from local flash (see 3.8). |
| `soundmachine_stop` | Exit soundmachine mode, return to `IDLE`. |

There is no `queue` command. With no local storage and no per-track device
queue, "queueing" a playlist is Server's job — it hands the device one URL
covering the whole listen (3.5).

### 3.3 Command × State/Mode Matrix

Every command MUST have defined behavior in every reachable state/mode
combination — no combination is allowed to be undefined or to silently
corrupt state. In particular:

| Command | During `SYSTEM_SOUND` | During `SOUNDMACHINE` |
|---|---|---|
| `play` | Deferred: finish the system sound, then play the new item. | Exits soundmachine mode, then plays normally. |
| `pause`/`resume` | No-op (system sounds are not pausable). | Pauses/resumes the looping track without exiting soundmachine mode. |
| `stop` | Stops the system sound, returns to `IDLE`/`NORMAL`. | Exits soundmachine mode, returns to `IDLE`/`NORMAL`. |
| `skip_next`/`skip_prev` | No-op. | No-op (soundmachine has nothing to skip). |
| `soundmachine(...)` | Deferred until the system sound finishes, same as `play`. | Replaces the current soundmachine track. |

**The `play`-during-`SYSTEM_SOUND` deferral is deliberate, not incidental,
for exactly one case: the read cue.** §5 requires an instant local sound the
moment a card is read, before its content is even resolved. Given one audio
output and no way to run two sources at once (3.4's constraint), that cue's
playback and the real content's connection setup are necessarily
sequential, not concurrent — so the cost of the read cue is additive to
total scan-to-sound latency, and the lever for keeping that cost small is
keeping the cue **very short** (§9: target ~100ms), not trying to overlap
it with the network connect.

`error_sound` (an internal trigger, not a remote command) additionally
returns playback to `IDLE` rather than resuming whatever was interrupted —
an error means "stop and wait for the next explicit action," not "try to
continue."

There is exactly one authority for "is sound machine active" — the mode value
in 3.1. No other module keeps its own copy. A `play` arriving during
`SOUNDMACHINE` must clear the mode as part of starting playback; otherwise the
track-end handling in 3.4 would take the loop branch and revert to the sound
machine once the new content finished.

### 3.4 Track-End Detection

**This is the single most important correctness requirement in this
document**, because `NORMAL` mode is the only way library content plays and
it is entirely network-sourced. A track MUST be detected as finished, and the
next action taken (advance / emit `finished` / loop), through **two
independent signals**, in every mode:

1. **EOF callback** from the decoder library, when it fires.
2. **Liveness check**: while in `PLAYING` state, if the decoder reports
   "not running" for longer than a short grace period (to allow for normal
   stream startup buffering), treat it as track-end.

Signal 2 exists because HTTP-streamed audio does not reliably deliver EOF
callbacks (connection resets, silent stalls, etc.). `SYSTEM_SOUND` and
`SOUNDMACHINE` play from local flash and are much less exposed to this
failure mode, but MUST still implement both signals — one consistent rule,
not one relaxed for the modes that happen to be safer.

`NORMAL` mode is where it matters most. A mode relying on EOF alone hangs
indefinitely on a stream that dies silently: state stays `PLAYING`, no status
is ever emitted, and the device stays unresponsive until an explicit `stop`
or `play` arrives. Since there is no local content to fall back to, such a
hang is a fully silent failure that the user cannot resolve except by
scanning another card or power-cycling.

### 3.5 Playback Sourcing & Gapless Playlists

There is no device-side play queue. `NORMAL` mode plays exactly one
connection at a time, and that connection covers the entire listen:

- **Single item** (a song, a podcast episode): `play(url, mediaId)` points
  directly at `/api/media/stream/:id`, same as today.
- **Playlist**: `play(url, playlistContextId)` points at a Server-generated
  **continuous stream** covering every track in the playlist, back to back,
  as one HTTP response. The device does not know or care that it's a
  playlist rather than a single file — it's one `connecttohost()` call
  either way.
- `play` **replaces**: stops whatever's currently playing and starts the
  new connection immediately. There is nothing left to "clear," since there
  was never a local queue.
- A connection reaching its end (3.4) MUST emit a `finished` status and
  return to `IDLE`/`NORMAL`. For a playlist stream, this means the *whole
  playlist* finished, not just one track — see below for per-track status
  during playback.

**Gaplessness is Server's responsibility, not the device's.** Because the
device never re-connects between tracks of a playlist, there's no
per-track network gap to hide — the tracks are already concatenated into
one stream before the device ever sees them. This trades the
per-track-network-gap problem for a different one: the device needs a way
to know which track within the stream is currently playing, for accurate
`playback_status` reporting, without a queue to walk. The plan is to use
the decoder library's existing ICY stream-metadata support
(`showstreamtitle()`/`evt_streamtitle` — this is standard internet-radio
"now playing" signaling, not something bespoke) — Server injects a
metadata block encoding the new `mediaId` at each track boundary within the
concatenated stream, and the device's existing metadata callback updates
its notion of "currently playing" and re-emits `playback_status`
accordingly, with **no new network connection**.

> **⚠ Provisional (device side only).** Server-side concatenation and ICY
> metadata injection are validated — see
> `decisions/2026-08-02-playlist-streaming.md`. What remains unconfirmed is
> how the device consumes it: that the `streamtitle` event fires mid-stream
> carrying the injected `mediaId`, and that the decoder crosses a track
> boundary without an audible artifact. Fallback if not: server-side
> transcoding, which changes no device-facing contract.

### 3.6 Skip Previous / Restart

With no device-side queue (3.5), skip is no longer something the device
resolves on its own — there's no local "next" or "previous" track to walk
to. It becomes a request Server fulfills:

- The device publishes a skip event (direction: next/previous) rather than
  locally advancing anything. Server, which is the one that knows the
  playlist's track order and the current position (from the ICY-metadata-
  driven status stream, 3.5), computes the target position and responds
  with a fresh `play` command pointing at a new continuous stream starting
  there.
- This means a skip pays a connection-setup cost the same as any other
  `play` (§9) — acceptable, since a skip is an explicit user action, unlike
  a natural track transition within a playlist, which stays gapless because
  it never leaves the existing connection (3.5).
- The restart-vs-previous rule: if more than a threshold (target: 3s) has
  elapsed since the current track started, or there's no meaningful
  "previous" (start of playlist), `skip_prev` restarts the current track
  rather than moving back one. This is Server's bookkeeping to apply when
  computing the target position, not the device's — the device keeps no
  track history.

The skip event MUST carry the device's elapsed position within the current
track, so Server can apply the restart-vs-previous rule above. Server knows
the playlist order and, from the last `playback_status`, which track is
playing — but not how far into it, and the device is the only party that
does.

### 3.7 Volume

Volume is a single integer scale, **0–42**, used consistently everywhere:
the audio output hardware/library configuration, the `volume` MQTT command,
`maxVolume` device setting, per-card volume override, sound-machine volume,
and all UI sliders. There is exactly one authoritative range in the system;
no component may impose a narrower hard limit than 0–42 without that limit
being the explicit, configured `maxVolume`.

- `maxVolume` (per device, default: no limit / 42) caps the *effective*
  volume: any requested level above it is clamped to it, and the physical
  volume-up button MUST NOT be able to exceed it either.
- Requests below 0 or above 42 are clamped to the nearest bound.
- Changing `maxVolume` such that it's below the current volume MUST reduce
  the current volume to match.

### 3.8 Sound Machine Mode

- **The device MUST hold its own local copy of the current sound-machine
  configuration** (which sound, at what volume) in NVS, synced from Server
  whenever it changes, not fetched on demand. A long-press MUST enter
  soundmachine mode using this local state alone — no MQTT round-trip, no
  network dependency, so it works exactly the same whether the server is
  reachable or not.
- Server MAY still push a `soundmachine` command directly to start the mode
  remotely (from the UI) — that path is unaffected and doesn't need local
  state, since it's already server-initiated.
- Whenever Server pushes an updated sound-machine configuration (a new
  sound chosen, volume changed), the device MUST download the new file to
  local flash and update its local config *before* discarding the old
  file/config — an update should never leave the device in a state where
  neither the old nor new sound is available locally.
- The configured track loops indefinitely until `soundmachine_stop` or a
  `play` command interrupts it.
- **Physical short-press and remote `pause` are intentionally different
  actions while soundmachine is active.** A physical short-press on the play
  button always exits soundmachine mode (`soundmachine_stop`) — there is no
  physical pause for the loop, only stop. A remote `pause` command, by
  contrast, pauses the loop in place (resumable via remote `resume`, per the
  matrix in 3.3) without exiting soundmachine mode. This asymmetry is
  deliberate: the physical button is a single control shared with
  play/pause for normal playback and has no way to express "pause vs. stop
  the loop," whereas the remote API has both commands available.
- Looping MUST use the same two-signal track-end detection as every other
  mode (3.4). Playing from local flash makes the EOF callback far more
  reliable than the current live-HTTP-loop implementation, but the liveness
  check stays as the safety net regardless, per 3.4's single consistent
  rule.
- If no sound machine sound is configured for the device (no local
  config), a long-press MUST produce a distinct, clearly-not-an-error cue
  rather than silently doing nothing — there's no server round-trip left to
  time out on, so this is a locally-known state, not an absence of
  response.

---

## 4. Local Flash Content

There is no SD card and no bulk media cache. The only content that lives on
the device is small, fixed, and rarely changes — stored in onboard flash
(LittleFS), not removable media:

- **System sounds**: startup, read cue, error. Effectively static; shipped
  with firmware or synced once and not expected to change per-device.
- **Sound-machine sound**: exactly one file per device at a time, per its
  local config (§3.8). Changes only when an admin reconfigures it — not a
  per-track, ever-growing library the way SD caching was.

Consequences of this being so much smaller in scope than the old SD cache:

- **No eviction policy needed.** There's at most one sound-machine file;
  replacing the config replaces the file (§3.8's "download new before
  discarding old" rule covers the only case that matters).
- **No background download queue needed.** A config change triggers one
  download, once, not an ongoing sync process.
- **No blocking-download-during-playback risk in the way SD caching had
  it.** Sound-machine/system-sound downloads are rare, small, and don't
  compete with `NORMAL`-mode streaming for the device's attention the way
  eager per-track SD caching did.
- Playback from local flash uses the same `connecttoFS()` mechanism as SD
  playback did — `LittleFS` implements the same filesystem interface `SD`
  did, so this reuses existing, already-understood playback code, just
  pointed at a different filesystem object.

---

## 5. NFC Card Handling

This section distinguishes two events that were previously conflated under
one word ("scanned"):

- **Read**: the NFC hardware has captured a UID. Purely local, no meaning
  attached yet, no lookup performed. This MUST produce the **read cue**
  (§3.1/§3.3's system sound) immediately — its purpose is specifically to
  tell the user it's safe to remove the card from the reader; they
  shouldn't need to guess how long to hold it there or wait for playback to
  confirm the read happened.
- **Scanned**: the existing recognize-and-resolve process — figuring out
  what a read UID actually maps to. This is the event that goes on the wire
  as `card_scanned` (§6) — that name doesn't change.

Sequence:

- Reads are polled non-blockingly (short per-read timeout) so scanning
  never stalls the main loop.
- A debounce window (target: 1.5s) prevents the same physical card being
  re-triggered by continuous presence on the reader.
- On read: play the read cue immediately (§3.3 — this is a `SYSTEM_SOUND`,
  so it necessarily delays the real content's connection start by its own
  short duration; see §9 for the target length).
- Resolution: the device holds **no local UID→content mapping of any
  kind.** Once the read cue finishes, it publishes `card_scanned` to Server
  and waits. Server resolves the card against its database and pushes back
  a `play` command, or `error_sound` if the card is unknown. This is a
  deliberate simplification, consistent with this system's general
  principle of keeping state on the server and the device as thin as
  possible (see Purpose): the round-trip this costs is small — local MQTT
  on the same network as the server that's already required for the
  content itself — against real complexity it avoids (a cache to keep in
  sync, sync commands, a device-side struct that would otherwise need to
  track playlist-vs-single-item shape). The tradeoff being made
  consciously: an approved device's NFC reads now mean nothing without a
  live conversation with Server, every time, with no local shortcut.
- **If resolution doesn't produce a `play` or `error_sound` within a bounded
  timeout** (§9; server unreachable, MQTT disconnected — see §1.4), the device
  MUST play a distinct cue indicating "read you, but can't do anything
  right now" rather than leaving the user with only the read cue and
  silence afterward, wondering if anything is coming. This cue is
  informational, not a cancellation: if a `play` arrives late, after the
  timeout has already fired, the device MUST still honor it.
- NFC scanning is disabled until the device is approved at least once (see
  1.3); after first approval it stays enabled across reboots regardless of
  connectivity, per the offline-mode requirement (1.4) — reads and the read
  cue keep working offline even when nothing can actually play.

---

## 6. MQTT Message Contract

### 6.1 Commands (Server → Device, topic `.../commands`, QoS 1)

| `command` | Fields | Effect |
|---|---|---|
| `play` | `url`, `mediaId` (or a playlist context id) | See 3.2/3.5 — single item or a continuous playlist stream, indistinguishable to the device |
| `pause` / `resume` / `stop` | — | See 3.2 |
| `skip` | `direction` | See 3.6 — Server responds with a fresh `play`, not a direct effect of this command itself |
| `volume` | `level` | See 3.7 |
| `ota` | `url`, `version`, `sha256` | See §7 |
| `config` | `status?`, `maxVolume?` | `status:"approved"` marks the device approved and triggers the startup sound (first time only); `maxVolume` updates the cap live |
| `soundmachine_config` | `url`, `name`, `volume` | Push a new sound-machine configuration (§3.8): device downloads the file to flash, updates local config, then discards the old one |
| `error_sound` | — | Plays the error clip; returns to `IDLE` (3.3) |

There is no `queue` command (3.2). There is no `sync_cards`, `card_update`,
`card_delete`, or `clear_cache` command — the device holds no card mapping
of any kind (§5), so there is nothing on the device to sync, update,
delete, or clear. Card management is entirely a server-side/database
concern (§12).

### 6.2 Events (Device → Server, topic `.../events`, QoS 0)

| `type` | Fields | Server behavior |
|---|---|---|
| `card_scanned` | `uid` | Resolve card, push a `play` command (or `error_sound` if unresolvable). Always a request, always waited on by the device. |
| `playback_status` | `status`, `mediaId?` | Update Server's mirrored status (see §8), notify UI. For a playlist stream, re-emitted at each track boundary via the device's ICY-metadata callback (3.5), not just on play/pause/stop transitions. |
| `device_logs` | `logs` (batched) | Surface to operator tooling |

These three are the complete event set. In particular there is no
"played from local cache" event (the device has no content cache) and no
sound-machine request event (the device acts on its own locally-stored config
rather than asking, §3.8).

### 6.3 Registration & Status

- `musicbox/register` (device → server, un-scoped topic): MAC, firmware
  version, IP. Server upserts the device record; if already `approved`,
  Server immediately re-sends `config` (covers reconnects, not just first
  boot).
- `.../status` (retained, both directions of the connection lifecycle):
  `{"online": true}` on connect, `{"online": false}` via LWT on ungraceful
  disconnect. This is the only heartbeat mechanism — there's no periodic
  "I'm still here" ping beyond MQTT's own keepalive.

---

## 7. OTA Updates

- Server exposes current firmware version + SHA256 + binary at fixed
  endpoints; the device (or Server pushing an `ota` command) compares
  versions to decide whether an update is needed.
- Before starting a download, the device MUST stop audio playback and disable
  NFC scanning. Because the stop is asynchronous, the device MUST *wait for
  confirmation* that playback actually reached `IDLE` rather than assuming a
  fixed delay was enough — OTA and playback competing for WiFi slows the
  download and a mid-flash reboot shouldn't leave a track "playing" from the
  app's perspective.
- **That wait MUST be bounded, and MUST NOT be able to block the update.** If
  playback doesn't confirm within the timeout (§9), the device proceeds with
  the update anyway and logs a warning. A wedged audio task is exactly the
  condition under which pushing new firmware matters most; being unable to
  recover such a device remotely would be a worse failure than a slower
  download.
- The binary is verified by SHA256 against the value provided by Server
  before `Update.end()` is called; on mismatch, the device MUST abort
  without applying the update.
- **The OTA download/flash procedure MUST budget for the task watchdog.**
  It is a long-running, potentially multi-tens-of-seconds operation; it
  MUST either periodically feed the watchdog or run under a watchdog
  timeout wide enough to cover realistic worst-case download+flash time on
  a weak WiFi link. A watchdog panic mid-OTA must not be the normal outcome
  for a slow network.
- On success, the device restarts into the new firmware. On any failure
  (download, verification, flash), the device MUST leave the previous
  firmware bootable and report failure rather than silently retrying
  forever.

---

## 8. Web Control Plane

### 8.1 Source of Truth

**The device is authoritative for its own playback state.** Server holds
only a *mirror* of the last-reported status, populated by MQTT events. The
UI must never assume a command it sent has taken effect until it observes
the corresponding `playback_status` event — control actions (pause, resume,
stop, volume) are fire-and-forget requests, not synchronous RPCs, and the UI
state (e.g. "paused" badge) reflects the last-known device report, not
optimistic local state.

### 8.2 Status Recovery

- Server's mirrored playback status is held in memory. Because it depends
  entirely on the device sending events, Server MUST have a way to converge
  back to correct state after its own restart or after a device reconnects
  silently: at minimum, the retained `.../status` topic tells Server
  online/offline immediately, and the device SHOULD re-announce its current
  playback status right after a fresh MQTT connection (not just on the next
  state change) so a Server restart doesn't leave every device shown as
  indefinitely stale.
- `lastSeen` on the device record MUST be refreshed whenever Server
  receives *any* signal from the device — including the `online: true`
  status message — not only on event messages. A device that reconnects but
  hasn't sent a playback event yet must not appear offline.

### 8.3 Online/Offline Determination

A device is "online" in the UI if both (a) `lastSeen` is recent (per a
defined staleness window) and (b) its retained status topic says
`online: true`. Controls (pause/resume/stop/volume/etc.) MUST be disabled
in the UI for any device that is not `approved` and currently online.

**Commands sent to an offline device are lost, not queued.** Both MQTT
clients connect with a clean (non-persistent) session, and QoS 1 only
guarantees delivery to a broker that has a live, subscribed session for the
recipient — it does not buffer messages for a client that is disconnected
with `clean: true`. Server and the UI MUST NOT assume a command will be
delivered once a device reconnects; this is why controls must be gated on
"online" (above) rather than relying on eventual delivery. If guaranteed
delivery to a device that's currently offline becomes a requirement, it
needs its own mechanism (e.g. Server persisting pending commands and
replaying them after observing the device's next `register`/online event),
not a change to MQTT QoS.

### 8.4 Media Streaming Endpoint

`GET /api/media/stream/:id` is consumed by both the ESP32 (via HTTP, no
browser semantics) and the browser preview player. It MUST:

- Support HTTP range requests (device seeking/resuming and library preview
  scrubbing both depend on this) and reject malformed or out-of-bounds
  ranges with `416 Range Not Satisfiable` rather than serving garbage
  bytes.
- Return `404` distinctly for "media row not found in DB" vs. "file missing
  from disk" — the latter indicates a data-integrity problem worth
  surfacing differently than a bad ID. A row with an **empty** `filePath`
  (see §11.3 — a podcast episode still `pending`/`downloading`) MUST be
  treated as "file missing," not passed through to the filesystem layer
  unchanged.
- Apply backpressure: a slow consumer (a device on weak WiFi) must not
  cause the server to buffer an entire file in memory. The stream from disk
  should pause when the outbound connection isn't ready for more data.

### 8.5 Continuous Playlist Stream

`GET /api/playlists/stream/:id` serves an entire playlist as one continuous
audio response, for the gapless-playback design in §3.5. (Path follows the
existing `api/<resource>/<action>/<param>` convention used by
`api/media/stream/:id` and `api/soundmachine/config/:mac`.) It MUST:

- Begin streaming promptly — comparable to single-track connect time — not
  wait until the full playlist is assembled server-side before sending the
  first byte. Tracks are read lazily, one at a time.
- **Emit audio frames only.** Each track's ID3v2 header, ID3v1 trailer, and
  Xing/Info/LAME VBR header frame MUST be stripped rather than passed
  through. These are not audio: they force the decoder to resync mid-stream
  and the VBR header frame decodes as silence. Appending whole files instead
  measurably loses audio and causes parsers to report a malformed stream.
- Rely on source files sharing one sample rate and channel count (§11.1).
  Given that, frame concatenation is sample-exact and needs no transcoding.
  A library with mixed sample rates would require transcoding instead —
  heavier and slower, with no change to the device-facing contract.
- Inject ICY-protocol metadata (`StreamTitle`) at each track boundary,
  encoding enough to identify the `mediaId` now playing, for the device's
  status-reporting mechanism (§3.5, §6.2). Announcement is quantised to the
  `icy-metaint` interval, so the reported track lags the true boundary by at
  most one interval (§9) — sub-second, and acceptable for status.
- **Send an exact `Content-Length`; never fall back to chunked transfer
  encoding.** Chunk-size framing interleaved with ICY metadata is an
  untested combination for the device's decoder, and a known-length body is
  its best-supported path. The length MUST be derived from the same pass
  that produces the byte plan, so the two cannot disagree.

To send `Content-Length` without first reading every file, the server needs
each track's *extracted audio* byte length up front. That length MUST be
computed once at ingest and stored alongside the media item (§11), not
recomputed per request.

### 8.6 Preview Player

The browser-based library preview player (`usePlayerState`/`MiniPlayer`) is
a **separate playback surface** — it plays audio directly in the browser
tab for library browsing/QA purposes and has no relationship to, and no
influence over, any physical device's playback state. This spec's playback
requirements (§3) do not apply to it; it is out of scope here beyond noting
that it must never be confused with device remote control in the UI.

---

## 9. Timing & Constants Reference

Single source of truth for every timing constant referenced above. If an
implementation needs a different value, this table should be updated to
match — values should not silently diverge between spec and code.

| Constant | Target | Rationale |
|---|---|---|
| Task watchdog timeout | 30s | Must exceed the longest routine blocking operation (see OTA note, §7) |
| WiFi initial connect grace window | ~3s | Boot must not stall waiting on WiFi |
| WiFi reconnect backoff | 1s → 30s, doubling | Avoid hammering AP after a WiFi outage |
| MQTT reconnect interval | 5s | Bounded retry without busy-looping |
| NFC read poll timeout | 50ms | Balance responsiveness vs. main-loop budget |
| NFC card debounce | 1.5s | Prevent re-trigger from continuous card presence |
| NFC init retry interval | 5s | Reader may not be present at boot |
| System-sound init delay | 50ms | Let decoder initialize before liveness-checking it |
| Read cue duration | ~100ms target | Short enough that its cost, additive to real content's connect time (§3.3), stays negligible |
| Soundmachine liveness grace period | 200ms | Same purpose as system-sound init delay; local flash reads are fast, this is a safety margin not a network allowance |
| Skip-previous restart threshold | 3s | "Meant to restart this track" vs. "meant to go back" |
| Card-scanned resolution timeout | 3s | Bounds the wait after publishing `card_scanned` before the "can't do anything right now" cue (§5). Long enough that a slow-but-working resolution isn't falsely flagged, short enough not to leave the user guessing |
| `icy-metaint` (playlist stream) | 8192 bytes | Audio between ICY metadata blocks (§8.5). Also the worst-case lag on reporting a track change: ~510ms at 128kbps, ~275ms at 238kbps |
| OTA HTTP timeout | 30s | Applies to the version-check and initial connect, not total download time |
| OTA pre-update audio-stop wait | 3s | Bounded wait for playback to confirm `IDLE` before updating (§7); proceeds anyway on timeout |
| Vol-up+down → restart | held ≥2s, release-triggered | Deliberate combo, distinguishable from factory reset |
| Vol-up+down → factory reset | held ≥5s | Long enough to be clearly intentional |
| Captive portal timeout | 300s | Long enough for a human to finish setup, bounded so it doesn't hang forever |

---

## 10. Cross-Cutting Error Handling Principles

- **No unbounded blocking on network I/O inside a task that owns other
  responsibilities.** Every HTTP/MQTT call with a timeout must either run
  somewhere that can afford to block for that long, or be broken into
  non-blocking chunks. (This principle is what §7's OTA note reduces to;
  §4's local-flash downloads are rare and small enough that this risk is
  largely designed away rather than mitigated.)
- **Every retry loop has a bounded backoff.** No fixed-interval hammering
  of a broker, AP, or HTTP endpoint that's known to be down.
- **Failures are reported, not swallowed.** A dropped command, a failed
  download, an unresolvable card — each has a defined signal (a status
  event, a log line, an error sound) rather than silently doing nothing.
- **State transitions are total, not partial.** Any (state, mode, command)
  combination not explicitly handled is a bug, not an implicit no-op — see
  §3.3's matrix as the model to extend when new commands are added.

---

## 11. Media Library & Ingestion

Media items (songs, podcast episodes, sound-machine sounds) live in one
unified `media` table with a `type` discriminator and type-specific fields
in a JSON `metadata` column, per the storage design in `CLAUDE.md`. Files
live on disk under `data/<songs|podcasts|soundmachine>/<uuid>.<ext>`,
referenced by a relative `filePath` — never in the database.

### 11.1 Manual Upload

`POST /api/media/upload` accepts a browser-uploaded file, validates its MIME
type against an allowlist, writes it to `data/songs/<uuid>.<ext>`, and
best-effort extracts duration/artist/album via ID3/metadata parsing.
Metadata extraction failure MUST NOT block the upload — the item is still
created, falling back to the filename (extension stripped) as the title.

**Uploaded files MUST be normalized to a single consistent codec, sample rate,
and channel count** — matching what the YouTube ingestion path produces (mono
MP3, per its `-ac 1` mixdown) — regardless of the format they arrive in. Every
file in the library is therefore frame-compatible with every other. This is a
prerequisite for §8.5's playlist stream to concatenate tracks cheaply; a
library mixing sample rates would force transcoding instead, which is slower
and heavier. Sample rate is the constraint that matters most — a decoder is
far likelier to break on a mid-stream rate change than a bitrate change.

**Every ingest path MUST also record the item's extracted-audio byte length**
(the size after stripping ID3 and VBR-header frames) and its frame-derived
duration. §8.5 needs the former to compute `Content-Length` without reading
every file in a playlist. Both come free from the same parse that validates
the file, and both are stable for the life of the file.

### 11.2 YouTube / YouTube Music Ingestion

Songs can be queued for download from YouTube Music. Each request becomes a
row in `downloadQueue` (status: `pending` → `downloading` → deleted on
success, or `failed` with a retained error message) and spawns a `yt-dlp`
subprocess:

- Requeuing a `videoId` already in the queue MUST return the existing queue
  entry rather than starting a second concurrent download of the same
  track. Requeuing a `videoId` that has **already completed** (no longer in
  `downloadQueue`, but present in `media` via its `youtubeVideoId`
  metadata) MUST also be recognized and short-circuited, not re-downloaded
  into a second, duplicate `media` row.
- Download progress is parsed from `yt-dlp`'s stdout and reflected in the
  queue row's `progress` field so the UI can show a live percentage.
- On success, a `media` row is created, the item is linked into a playlist
  at a given position if one was specified (album downloads always do
  this), and the queue row is deleted — the queue is a transient work list,
  not a permanent download history.
- On failure, the queue row is kept with `status: failed` and an error
  message, and MUST be retryable (`retryDownload`) or removable
  (`removeFromQueue`) without leaving orphaned partial files on disk — a
  retry MUST NOT accumulate a new partial file per attempt.
- Downloading an entire album enqueues every track individually against a
  newly created playlist, in track order.

### 11.3 Podcast Feeds

Each `podcastFeeds` row is a subscribed RSS feed with a `retentionCount`
(episodes to keep, 1–10). Refreshing a feed:

1. Parses the RSS feed and diffs episode GUIDs against existing `media`
   rows already tagged with that feed's ID in their metadata.
2. Inserts genuinely new episodes immediately as `media` rows with
   `downloadStatus: pending` and no `filePath`, so the UI can list them
   before their audio has been fetched.
3. Downloads each new episode's audio directly from its RSS enclosure URL
   and updates the row to `downloadStatus: complete` with a real
   `filePath` — or `failed`, with any partial file cleaned up.
4. Enforces retention every refresh (and whenever `retentionCount`
   changes): episodes beyond the retention count, oldest first by publish
   date, have both their file and DB row deleted.

A card mapped to a podcast feed MUST resolve, at scan time, to whichever
episode is currently that feed's newest **and fully downloaded**
(`downloadStatus: complete`) episode — never a snapshot taken when the card
was created, and never an episode still `pending`/`downloading`/`failed`.

Feed refresh (fetching new episodes from the RSS feed) MUST be available
on-demand and SHOULD also run on a periodic schedule, so cards stay current
without requiring someone to open the UI and click refresh — a subscription
whose content only updates when manually poked defeats the point of
subscribing.

Episode→feed association is currently inferred from a `feedId` stored in the
episode's JSON metadata. An explicit `podcastEpisodeFeeds` linking table (per
`CLAUDE.md`'s storage design) would be a cleaner representation, but is not
required for correct behavior and is not currently planned.

### 11.4 File Lifecycle

Per `CLAUDE.md`'s storage design: deleting a media item MUST delete its
on-disk file before (or atomically with) removing the DB row, and MUST
still remove the DB row even if the file is already missing — a missing
file is not a reason to leave a dangling record. Podcast retention cleanup
and feed deletion already follow this file-then-row order with delete-error
tolerance; the same discipline applies to any other media deletion path.
System sounds and sound-machine sounds seeded from `seed-data/` are marked
`system: true` in metadata and MUST be excluded from any user-facing delete
action, since firmware paths depend on their continued existence.

---

## 12. Card Management

- A card maps to exactly one of: a single media item, a playlist, or a
  podcast feed. The three foreign keys are mutually exclusive by
  application convention (every write path clears the other two whenever
  one is set) rather than by a database constraint.
- Card management is entirely a server-side/database concern. Creating,
  editing, or deleting a card takes effect on the next scan of that card —
  there is nothing to push to any device (§5, §6.1), so there is no
  propagation delay, no device restart, and no re-sync step to reason
  about. This is a direct consequence of the device holding no card
  mapping at all.
- A card's `volume` is optional; `null` means "leave the device's current
  volume as-is," not "set to zero" or "use some default." This distinction
  must be preserved through every resolution path (direct media, playlist,
  podcast feed) — there is now only one such path, the server round-trip on
  scan (§5).
- Deleting the media item, playlist, or podcast feed a card points to
  cascades to delete the card mapping itself — a card left pointing at
  nothing is not a state the system needs to represent or recover from.

---

## 13. Security & Access Control

> **⚠ DEFERRED — no work planned.** The system currently has no authentication
> or authorization anywhere: the control-plane UI, every server function
> (approve/reject a device, trigger OTA, delete media), and the MQTT broker
> (`allow_anonymous true`) are open to anyone who can reach them on the
> network. This is a **consciously accepted risk** for a trusted home LAN, not
> an oversight. The section below states what the system should eventually
> require; none of it is scheduled. Revisit before any deployment beyond a
> single household, or before exposing the server remotely.

When authentication is implemented, it should satisfy the following. Note that
`docs/server-auth-plan.md` sketches a JWT-based web UI layer (admin /
media-manager roles) that predates this spec and remains unimplemented.

- Server functions that mutate device state, approve/reject devices, manage
  users, or trigger OTA MUST require authentication once implemented.
  Device-facing endpoints (media streaming, MQTT command/event topics) MAY
  remain open to the local network, since the ESP32 firmware has no
  mechanism to hold user credentials — this matches
  `server-auth-plan.md`'s existing "streaming endpoints remain public"
  position and should stay an explicit, documented exception rather than
  an oversight.
- The `devices.secret` column is generated on registration and is not read
  anywhere else in the codebase today — it authenticates nothing. Either
  the device-to-server trust model should actually use it (e.g. a device
  presents it on reconnect/registration, Server validates before accepting
  commands or re-registration), or it should be removed so it stops
  implying a security boundary that doesn't exist.
- MQTT has no authentication and no TLS. Any device on the network can
  publish to any other device's command topic, forge a registration, or
  subscribe to every device's events and logs. This is a reasonable
  default for the project's stated context (a trusted home LAN) but MUST be
  an explicit, accepted risk rather than an assumption — and revisited
  before any deployment beyond a single trusted home network (remote
  access, multiple households, etc.).

Web UI authentication and MQTT/device authentication are separable: the former
touches only the server and could be added without any firmware change, while
the latter requires credential provisioning and storage on a device that has
only NVS, and warrants its own design pass.
