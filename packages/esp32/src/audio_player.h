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

// Volume (0-21)
void audio_set_volume(int level);
int audio_get_volume();

// State
AudioState audio_get_state();
int audio_get_current_media_id();

// Callbacks
void audio_on_track_ended(TrackEndedCallback callback);
void audio_on_queue_empty(QueueEmptyCallback callback);

#endif
