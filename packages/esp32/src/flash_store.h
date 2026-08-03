#ifndef FLASH_STORE_H
#define FLASH_STORE_H

#include <Arduino.h>

// ─────────────────────────────────────────────────────────────────────────────
// Local content on internal flash (LittleFS).
//
// This is everything the device can play without the network: the short system
// cues, and one sound machine loop. Library media is never stored here — it is
// streamed (see audio_player).
//
// The filesystem partition is 3.38MB and cannot be enlarged over OTA, so the
// sound machine file has to be encoded to fit inside it with headroom.
//
// Writing internal flash briefly disables the flash cache, which stalls code
// running from flash and can glitch playing audio. Downloads therefore never
// happen inline: they are requested, then performed by flash_process() when
// the audio task is idle.
// ─────────────────────────────────────────────────────────────────────────────

typedef enum {
    SOUND_STARTUP,   // played once when the device becomes ready
    SOUND_READ_CUE,  // fired the instant an NFC uid is captured
    SOUND_ERROR,     // unresolvable card, or nothing playable
} SystemSound;

// Mount the filesystem. Call from the audio task, since that task is the only
// one allowed to touch it afterwards.
bool flash_init();
bool flash_available();

// Absolute LittleFS path for a system sound, or NULL if it isn't present.
const char* flash_system_sound_path(SystemSound sound);

// Queue a download of any missing system sounds. Safe to call from any core.
void flash_request_system_sounds();

// ── Sound machine ───────────────────────────────────────────────────────────
// The device keeps its own copy of which sound is configured, so a long-press
// works with no round trip and keeps working when the server is unreachable.

// Path of the stored sound machine file, or NULL if none is configured.
const char* flash_soundmachine_path();

// Configured playback volume, or -1 to leave the current volume alone.
int flash_soundmachine_volume();

// Friendly name, for logs. Empty string when unconfigured.
const char* flash_soundmachine_name();

// Apply a configuration pushed by the server. Downloads the file if it differs
// from what is stored. A NULL url clears the configuration. Safe to call from
// any core; the work happens in flash_process().
void flash_set_soundmachine_config(const char* url, const char* name, int volume);

// Perform one unit of pending work (a download, a delete). MUST only be called
// from the audio task, and only while nothing is playing.
void flash_process();

// Is there pending work? Lets the caller avoid entering flash_process() at all.
bool flash_has_pending_work();

#endif
