# MusicBox Project Instructions

## Context Files

When working on this project, read the following files into context:

- `docs/SYSTEM-BEHAVIOR-SPEC.md` - Normative spec for how the device, MQTT contract, and web control plane are expected to behave. Describes the target state, not current code. Read this before making playback, connectivity, OTA, or device-lifecycle changes.
- `docs/IMPLEMENTATION-BACKLOG.md` - Where the code currently diverges from the spec, and the work left to close the gap. Track work here rather than editing the spec; completed items get deleted, not checked off.
- `DEVELOPMENT.md` - How to run the server, broker, and device locally.

Reference only, not authoritative:

- `docs/ESP32-BUILD-GUIDE.md` - How the player was originally built. Its hardware sections (components, pin reference, Phases 1-4 and 6) are still accurate and useful; Phase 5 and everything from Phase 7 on describe a superseded architecture (SD card, a separate Hono API, WebSocket transport). Its own banner says which is which. Where it conflicts with the spec, the spec wins.

## Project Structure

- `packages/esp32/` - ESP32 PlatformIO project for the hardware player
- `packages/web/` - TanStack Start web app (UI + API server + SQLite database + MQTT bridge), all one process

Device and server talk only over MQTT (Mosquitto) plus the handful of HTTP endpoints the device pulls from, listed in spec §8.4b.

## Control Plane Design

The Control Plane UI is built. Match the conventions already in `packages/web/src/routes/_library/` and the shadcn-style primitives in `src/components/ui/` rather than introducing a new pattern.

## Development Workflow

Work is tracked in `docs/IMPLEMENTATION-BACKLOG.md`, not in step order.

1. Check the backlog for the item you're working on, and the spec section it cites.
2. Make the change, then delete the item from the backlog — don't check it off and leave it. The spec describes the finished state and should not need editing as code catches up to it, so a completed item is just a stale second copy. The commit that closes an item is where its reasoning belongs; `git log -p docs/IMPLEMENTATION-BACKLOG.md` recovers anything trimmed.
3. If the code needs to diverge from the spec, change the spec deliberately and say why - don't let them drift silently.

## Code Style

- Write C-style C++ as much as possible (prefer C idioms, simple structs, functions over classes)

## Media Storage Design

### Unified Media Table
Songs, podcasts, and sound machine sounds are stored in a single `media` table with a `type` discriminator. Type-specific metadata (artist, album, podcast show name, etc.) stored in JSON `metadata` field.

### File Storage
- Files stored on disk, not in database (keeps DB lean, handles large podcast files)
- File path stored in DB `filePath` column
- Directory structure:
  ```
  data/
    songs/<uuid>.mp3
    podcasts/<uuid>.mp3
    soundmachine/<name>.mp3  (pre-bundled)
  ```

### Sound Machine Sounds
- Shipped in `packages/web/seed-data/soundmachine/`, copied into `data/soundmachine/` and seeded into the DB at server startup
- Marked with `system: true` in metadata to prevent deletion
- Device-side storage/sync of the sound-machine sound (and system sounds)
  is a separate concern — see `docs/SYSTEM-BEHAVIOR-SPEC.md` §3.8 and §4.
  The device has no SD card; it holds these on local flash.

### Missing File Handling
- Check file exists before streaming
- Return 404 with clear error if file missing
- Optional: health check endpoint to scan for orphaned DB entries

### File Cleanup on Delete
- Delete file first, then DB entry
- If file already gone, still remove DB entry
- Upload failures: cleanup partial files
- System files (sound machine): prevent deletion via API

### Podcast Management
Implemented - see spec §11.3 for the normative behavior.
- `podcastFeeds` table (name, feedUrl, imageUrl, retentionCount, lastFetchedAt)
- Retention policy: auto-deletes oldest episodes beyond retentionCount
- Episode→feed association is a `feedId` in the episode's JSON metadata. The `podcastEpisodeFeeds` linking table this document originally called for was never added; it would be cleaner but isn't needed for correct behavior, and is not planned.
- Not built: dynamic playlist items ("newest from feed X" as a playlist entry). A card can point at a feed directly, which covers the same need.