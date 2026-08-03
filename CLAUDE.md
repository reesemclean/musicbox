# MusicBox Project Instructions

## Context Files

When working on this project, read the following files into context:

- `docs/ESP32-BUILD-GUIDE.md` - Step-by-step guide for building the ESP32 player
- `docs/BUILD-GUIDE-TODOS.md` - Progress tracker for the build guide
- `docs/SYSTEM-BEHAVIOR-SPEC.md` - Normative spec for how the device, MQTT contract, and web control plane are expected to behave. Describes the target state, not current code. Read this before making playback, connectivity, OTA, or device-lifecycle changes.
- `docs/IMPLEMENTATION-BACKLOG.md` - Where the code currently diverges from the spec, and the work left to close the gap. Check items off here rather than editing the spec.

## Project Structure

- `packages/esp32/` - ESP32 PlatformIO project for the hardware player
- `packages/web/` - TanStack Start web app (UI + API server + SQLite database)

## Control Plane Design

When building the Control Plane (web UI), use the design from the existing prototype as reference. Add specific design details here as we get to Phase 8.

## Development Workflow

1. Follow the ESP32 Build Guide step-by-step
2. After completing and verifying each step, mark it as complete in `docs/BUILD-GUIDE-TODOS.md`
3. Commit the step with a message referencing the step number (e.g., "Step 1.1: ESP32 Hello World")

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
- Pre-bundled in `data/soundmachine/` (server-side library storage)
- Seeded into DB on first run
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

### Podcast Management (Future)
When implementing podcast support:
- Add `podcastFeeds` table (name, feedUrl, imageUrl, retentionCount, lastFetchedAt)
- Add `podcastEpisodeFeeds` linking table (mediaId → feedId) to keep `media` table generic
- Retention policy: auto-delete oldest episodes beyond retentionCount
- Dynamic playlist items: support "newest from feed X" references (feedId + position instead of mediaId)