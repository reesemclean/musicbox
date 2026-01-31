#ifndef AUDIO_PLAYER_H
#define AUDIO_PLAYER_H

#include <functional>

// Playback state
enum AudioState {
    AUDIO_IDLE,
    AUDIO_PLAYING,
    AUDIO_PAUSED
};

// Callbacks
typedef std::function<void()> TrackEndedCallback;
typedef std::function<void()> QueueEmptyCallback;
typedef std::function<void(const char* status, int mediaId)> PlaybackStatusCallback;

// Initialize audio player (I2S output)
bool audio_init();

// System sounds (from SPIFFS, plays immediately)
void audio_play_startup_sound();
void audio_play_card_scan_sound();
void audio_play_error_sound();

// URL playback
void audio_play_url(const char* url, int mediaId);
void audio_queue_url(const char* url, int mediaId);  // Add to queue for gapless
void audio_clear_queue();

// Playback control
void audio_pause();
void audio_resume();
void audio_stop();
void audio_skip_next();
void audio_skip_prev();

// Volume (0-21)
void audio_set_volume(int level);
int audio_get_volume();

// State
AudioState audio_get_state();
int audio_get_current_media_id();

// Sound machine mode (looping playback)
void audio_play_soundmachine(const char* url, const char* name);
void audio_stop_soundmachine();
bool audio_is_soundmachine_mode();

// Callbacks
void audio_on_track_ended(TrackEndedCallback callback);
void audio_on_queue_empty(QueueEmptyCallback callback);
void audio_on_playback_status(PlaybackStatusCallback callback);

#endif
