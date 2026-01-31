#include "audio_player.h"
#include <Arduino.h>
#include <SPIFFS.h>
#include "Audio.h"

// I2S pins for MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

// FreeRTOS task for audio processing on Core 0
static TaskHandle_t audioTaskHandle = NULL;

// System sound files
#define SOUND_STARTUP "/startup.mp3"
#define SOUND_CARD_SCAN "/scan.mp3"

// Queue for gapless playback
#define MAX_QUEUE_SIZE 50

struct QueueItem {
    char url[256];
    int mediaId;
};

// Audio instance
static Audio audio;

// State
static AudioState state = AUDIO_IDLE;
static int current_media_id = -1;
static int current_volume = 10;
static bool playing_system_sound = false;

// Queue
static QueueItem queue[MAX_QUEUE_SIZE];
static int queue_head = 0;
static int queue_tail = 0;
static int queue_count = 0;

// Pending URL to play after system sound
static char pending_url[256] = {0};
static int pending_media_id = -1;

// Callbacks
static TrackEndedCallback on_track_ended = nullptr;
static QueueEmptyCallback on_queue_empty = nullptr;

// Forward declarations
static void play_next_in_queue();

// Audio task runs on Core 0, leaving Core 1 free for buttons/NFC/etc
static void audioTask(void* parameter) {
    Serial.println("[Audio] Task started on Core 0");
    for (;;) {
        audio.loop();
        vTaskDelay(1);  // Small yield to prevent watchdog
    }
}

bool audio_init() {
    Serial.println("[Audio] Initializing...");

    // Initialize SPIFFS for system sounds
    if (!SPIFFS.begin(true)) {
        Serial.println("[Audio] SPIFFS mount failed");
        return false;
    }
    Serial.println("[Audio] SPIFFS mounted");

    // List available sound files
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    while (file) {
        Serial.printf("[Audio] Found: %s (%d bytes)\n", file.name(), file.size());
        file = root.openNextFile();
    }

    // Initialize I2S audio
    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.setVolume(current_volume);

    // Start audio task on Core 0 (main loop runs on Core 1)
    xTaskCreatePinnedToCore(
        audioTask,          // Task function
        "AudioTask",        // Name
        8192,               // Stack size
        NULL,               // Parameters
        1,                  // Priority
        &audioTaskHandle,   // Task handle
        0                   // Core 0
    );

    Serial.println("[Audio] Ready (task on Core 0)");
    return true;
}

void audio_play_startup_sound() {
    if (SPIFFS.exists(SOUND_STARTUP)) {
        Serial.println("[Audio] Playing startup sound");
        playing_system_sound = true;
        audio.connecttoFS(SPIFFS, SOUND_STARTUP);
        state = AUDIO_PLAYING;
    } else {
        Serial.println("[Audio] Startup sound not found");
    }
}

void audio_play_card_scan_sound() {
    if (SPIFFS.exists(SOUND_CARD_SCAN)) {
        Serial.println("[Audio] Playing card scan sound");
        playing_system_sound = true;
        audio.connecttoFS(SPIFFS, SOUND_CARD_SCAN);
        state = AUDIO_PLAYING;
    } else {
        Serial.println("[Audio] Card scan sound not found");
    }
}

void audio_play_url(const char* url, int mediaId) {
    // If playing system sound, queue this as pending
    if (playing_system_sound) {
        strncpy(pending_url, url, sizeof(pending_url) - 1);
        pending_media_id = mediaId;
        Serial.printf("[Audio] Queued pending URL: %s\n", url);
        return;
    }

    // Clear any existing queue
    audio_clear_queue();

    Serial.printf("[Audio] Playing URL: %s (mediaId: %d)\n", url, mediaId);
    current_media_id = mediaId;
    audio.connecttohost(url);
    state = AUDIO_PLAYING;
}

void audio_queue_url(const char* url, int mediaId) {
    if (queue_count >= MAX_QUEUE_SIZE) {
        Serial.println("[Audio] Queue full, dropping track");
        return;
    }

    strncpy(queue[queue_tail].url, url, sizeof(queue[queue_tail].url) - 1);
    queue[queue_tail].mediaId = mediaId;
    queue_tail = (queue_tail + 1) % MAX_QUEUE_SIZE;
    queue_count++;

    Serial.printf("[Audio] Queued: %s (queue size: %d)\n", url, queue_count);

    // If not playing, start the queue
    if (state == AUDIO_IDLE && !playing_system_sound) {
        play_next_in_queue();
    }
}

void audio_clear_queue() {
    queue_head = 0;
    queue_tail = 0;
    queue_count = 0;
    pending_url[0] = '\0';
    pending_media_id = -1;
    Serial.println("[Audio] Queue cleared");
}

static void play_next_in_queue() {
    if (queue_count == 0) {
        Serial.println("[Audio] Queue empty");
        state = AUDIO_IDLE;
        current_media_id = -1;
        if (on_queue_empty) {
            on_queue_empty();
        }
        return;
    }

    QueueItem* item = &queue[queue_head];
    queue_head = (queue_head + 1) % MAX_QUEUE_SIZE;
    queue_count--;

    Serial.printf("[Audio] Playing next in queue: %s (remaining: %d)\n", item->url, queue_count);
    current_media_id = item->mediaId;
    audio.connecttohost(item->url);
    state = AUDIO_PLAYING;
}

void audio_pause() {
    if (state == AUDIO_PLAYING) {
        audio.pauseResume();
        state = AUDIO_PAUSED;
        Serial.println("[Audio] Paused");
    }
}

void audio_resume() {
    if (state == AUDIO_PAUSED) {
        audio.pauseResume();
        state = AUDIO_PLAYING;
        Serial.println("[Audio] Resumed");
    }
}

void audio_stop() {
    audio.stopSong();
    audio_clear_queue();
    state = AUDIO_IDLE;
    current_media_id = -1;
    playing_system_sound = false;
    Serial.println("[Audio] Stopped");
}

void audio_set_volume(int level) {
    if (level < 0) level = 0;
    if (level > 21) level = 21;
    current_volume = level;
    audio.setVolume(level);
    Serial.printf("[Audio] Volume: %d\n", level);
}

int audio_get_volume() {
    return current_volume;
}

AudioState audio_get_state() {
    return state;
}

int audio_get_current_media_id() {
    return current_media_id;
}

void audio_on_track_ended(TrackEndedCallback callback) {
    on_track_ended = callback;
}

void audio_on_queue_empty(QueueEmptyCallback callback) {
    on_queue_empty = callback;
}


// ESP32-audioI2S callback - called when track ends
void audio_eof_mp3(const char* info) {
    Serial.printf("[Audio] Track ended: %s\n", info);

    if (playing_system_sound) {
        playing_system_sound = false;

        // Check if there's a pending URL to play
        if (pending_url[0] != '\0') {
            Serial.printf("[Audio] Playing pending URL: %s\n", pending_url);
            current_media_id = pending_media_id;
            audio.connecttohost(pending_url);
            pending_url[0] = '\0';
            pending_media_id = -1;
            state = AUDIO_PLAYING;
            return;
        }

        // Check if there's a queue
        if (queue_count > 0) {
            play_next_in_queue();
            return;
        }

        state = AUDIO_IDLE;
        return;
    }

    // Notify callback
    if (on_track_ended) {
        on_track_ended();
    }

    // Play next in queue (gapless)
    play_next_in_queue();
}
