#ifndef AUDIO_PLAYER_H
#define AUDIO_PLAYER_H

#include <functional>
#include "flash_store.h"

// ─────────────────────────────────────────────────────────────────────────────
// Playback.
//
// State says whether audio is flowing. Mode says where it is coming from, and
// determines what a track ending means. They are orthogonal, and the mode is a
// single value — not a set of flags — so it is impossible to be in two modes at
// once or to leave a stale one set after switching.
// ─────────────────────────────────────────────────────────────────────────────

typedef enum {
    AUDIO_IDLE,
    AUDIO_PLAYING,
    AUDIO_PAUSED,
} AudioState;

typedef enum {
    // Library content, streamed from the server. One connection covers the
    // whole listen: a single track, or a playlist the server concatenates.
    MODE_NORMAL,
    // A short local cue. Never streamed.
    MODE_SYSTEM_SOUND,
    // A local file looped until stopped. Never streamed.
    MODE_SOUNDMACHINE,
} AudioMode;

typedef std::function<void(const char* status, int mediaId)> PlaybackStatusCallback;

bool audio_init();

// Stream library content. Replaces whatever is playing and leaves any
// sound machine mode. `mediaId` is what gets reported until the stream
// announces something else.
void audio_play_stream(const char* url, int mediaId);

void audio_play_system_sound(SystemSound sound);

// Loop a local file until stopped. Volume < 0 leaves the current volume.
void audio_play_soundmachine(const char* path, int volume);
void audio_stop_soundmachine();

void audio_pause();
void audio_resume();
void audio_stop();

// Volume, 0..42. Requests above the configured max are clamped to it.
void audio_set_volume(int level);
int audio_get_volume();
void audio_set_max_volume(int level);
int audio_get_max_volume();

AudioState audio_get_state();
AudioMode audio_get_mode();

// Seconds into the current track. Sent with a skip so the server can decide
// between "go back one" and "restart this one".
uint32_t audio_get_elapsed_sec();

void audio_on_playback_status(PlaybackStatusCallback callback);

#endif
