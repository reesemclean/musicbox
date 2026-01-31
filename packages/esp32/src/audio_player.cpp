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
#define SOUND_ERROR "/error.mp3"

// ─────────────────────────────────────────────────────────────────────────────
// Command queue for thread-safe audio control
// All audio operations are sent to Core 0 via this queue
// ─────────────────────────────────────────────────────────────────────────────

enum CommandType {
    CMD_PLAY_URL,
    CMD_QUEUE_URL,
    CMD_PLAY_SYSTEM_SOUND,
    CMD_PAUSE,
    CMD_RESUME,
    CMD_STOP,
    CMD_SET_VOLUME,
    CMD_SKIP_NEXT,
    CMD_SKIP_PREV,
    CMD_CLEAR_QUEUE,
    CMD_PLAY_SOUNDMACHINE,
    CMD_STOP_SOUNDMACHINE,
};

enum SystemSoundType {
    SOUND_TYPE_STARTUP,
    SOUND_TYPE_CARD_SCAN,
    SOUND_TYPE_ERROR,
};

struct AudioCommand {
    CommandType type;
    char url[256];
    char name[64];
    int mediaId;
    int volume;
    SystemSoundType soundType;
};

// Command queue - holds up to 10 pending commands
static QueueHandle_t commandQueue = NULL;
#define COMMAND_QUEUE_SIZE 10

// ─────────────────────────────────────────────────────────────────────────────
// Playback queue for gapless playback
// ─────────────────────────────────────────────────────────────────────────────

#define MAX_QUEUE_SIZE 50

struct QueueItem {
    char url[256];
    int mediaId;
};

// Audio instance
static Audio audio;

// State (only modified on Core 0)
static volatile AudioState state = AUDIO_IDLE;
static volatile int current_media_id = -1;
static int current_volume = 10;
static bool playing_system_sound = false;

// Sound machine mode (looping playback)
static bool soundmachine_mode = false;
static char soundmachine_url[256] = {0};
static char soundmachine_name[64] = {0};

// Playback queue
static QueueItem playQueue[MAX_QUEUE_SIZE];
static int queue_head = 0;
static int queue_tail = 0;
static int queue_count = 0;

// Pending URL to play after system sound
static char pending_url[256] = {0};
static int pending_media_id = -1;

// Current track info for restart/previous
static char current_url[256] = {0};
static unsigned long track_start_time = 0;

// History for previous track (simple single-track history)
static char prev_url[256] = {0};
static int prev_media_id = -1;

// Callbacks
static TrackEndedCallback on_track_ended = nullptr;
static QueueEmptyCallback on_queue_empty = nullptr;
static PlaybackStatusCallback on_playback_status = nullptr;

// ─────────────────────────────────────────────────────────────────────────────
// Internal functions (run on Core 0)
// ─────────────────────────────────────────────────────────────────────────────

static void emit_status(const char* status) {
    if (on_playback_status) {
        on_playback_status(status, current_media_id);
    }
}

static void clear_queue_internal() {
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
        emit_status("finished");
        state = AUDIO_IDLE;
        current_media_id = -1;
        if (on_queue_empty) {
            on_queue_empty();
        }
        return;
    }

    QueueItem* item = &playQueue[queue_head];
    queue_head = (queue_head + 1) % MAX_QUEUE_SIZE;
    queue_count--;

    Serial.printf("[Audio] Playing next in queue: %s (remaining: %d)\n", item->url, queue_count);

    // Save current as previous before replacing
    if (current_url[0] != '\0' && current_media_id >= 0) {
        strncpy(prev_url, current_url, sizeof(prev_url) - 1);
        prev_media_id = current_media_id;
    }

    // Save new current track info
    strncpy(current_url, item->url, sizeof(current_url) - 1);
    current_media_id = item->mediaId;
    track_start_time = millis();

    audio.connecttohost(item->url);
    state = AUDIO_PLAYING;
    emit_status("playing");
}

static void handle_play_system_sound(SystemSoundType soundType) {
    const char* soundFile = nullptr;
    const char* soundName = nullptr;

    switch (soundType) {
        case SOUND_TYPE_STARTUP:
            soundFile = SOUND_STARTUP;
            soundName = "startup";
            break;
        case SOUND_TYPE_CARD_SCAN:
            soundFile = SOUND_CARD_SCAN;
            soundName = "card scan";
            break;
        case SOUND_TYPE_ERROR:
            soundFile = SOUND_ERROR;
            soundName = "error";
            break;
    }

    if (soundFile && SPIFFS.exists(soundFile)) {
        Serial.printf("[Audio] Playing %s sound\n", soundName);
        audio.stopSong();
        playing_system_sound = true;
        audio.connecttoFS(SPIFFS, soundFile);
        state = AUDIO_PLAYING;
    } else {
        Serial.printf("[Audio] %s sound not found\n", soundName);
    }
}

static void handle_play_url(const char* url, int mediaId) {
    // If playing system sound, queue this as pending
    if (playing_system_sound) {
        strncpy(pending_url, url, sizeof(pending_url) - 1);
        pending_media_id = mediaId;
        Serial.printf("[Audio] Queued pending URL: %s\n", url);
        return;
    }

    // Stop current audio
    if (state != AUDIO_IDLE) {
        audio.stopSong();
    }

    // Clear any existing queue
    clear_queue_internal();

    Serial.printf("[Audio] Playing URL: %s (mediaId: %d)\n", url, mediaId);

    // Save current as previous before replacing
    if (current_url[0] != '\0' && current_media_id >= 0) {
        strncpy(prev_url, current_url, sizeof(prev_url) - 1);
        prev_media_id = current_media_id;
    }

    // Save new current track info
    strncpy(current_url, url, sizeof(current_url) - 1);
    current_media_id = mediaId;
    track_start_time = millis();

    audio.connecttohost(url);
    state = AUDIO_PLAYING;
    emit_status("playing");
}

static void handle_queue_url(const char* url, int mediaId) {
    if (queue_count >= MAX_QUEUE_SIZE) {
        Serial.println("[Audio] Queue full, dropping track");
        return;
    }

    strncpy(playQueue[queue_tail].url, url, sizeof(playQueue[queue_tail].url) - 1);
    playQueue[queue_tail].mediaId = mediaId;
    queue_tail = (queue_tail + 1) % MAX_QUEUE_SIZE;
    queue_count++;

    Serial.printf("[Audio] Queued: %s (queue size: %d)\n", url, queue_count);

    // If not playing, start the queue
    if (state == AUDIO_IDLE && !playing_system_sound) {
        play_next_in_queue();
    }
}

static void handle_pause() {
    if (state == AUDIO_PLAYING) {
        audio.pauseResume();
        state = AUDIO_PAUSED;
        Serial.println("[Audio] Paused");
        emit_status("paused");
    }
}

static void handle_resume() {
    if (state == AUDIO_PAUSED) {
        audio.pauseResume();
        state = AUDIO_PLAYING;
        Serial.println("[Audio] Resumed");
        emit_status("playing");
    }
}

static void handle_stop() {
    audio.stopSong();
    clear_queue_internal();
    state = AUDIO_IDLE;
    int stoppedMediaId = current_media_id;
    current_media_id = -1;
    playing_system_sound = false;
    Serial.println("[Audio] Stopped");
    if (stoppedMediaId >= 0) {
        emit_status("stopped");
    }
}

static void handle_set_volume(int level) {
    if (level < 0) level = 0;
    if (level > 21) level = 21;
    current_volume = level;
    audio.setVolume(level);
    Serial.printf("[Audio] Volume: %d\n", level);
}

static void handle_skip_next() {
    if (queue_count > 0) {
        Serial.println("[Audio] Skipping to next track");
        audio.stopSong();
        play_next_in_queue();
    } else {
        Serial.println("[Audio] No next track in queue");
    }
}

static void handle_skip_prev() {
    if (state != AUDIO_PLAYING && state != AUDIO_PAUSED) {
        Serial.println("[Audio] Nothing playing");
        return;
    }

    unsigned long elapsed = millis() - track_start_time;
    const unsigned long RESTART_THRESHOLD = 3000;  // 3 seconds

    if (elapsed > RESTART_THRESHOLD || prev_url[0] == '\0') {
        // More than 3 seconds in, or no previous track - restart current
        if (current_url[0] != '\0') {
            Serial.println("[Audio] Restarting current track");
            audio.stopSong();
            track_start_time = millis();
            audio.connecttohost(current_url);
            state = AUDIO_PLAYING;
            emit_status("playing");
        }
    } else {
        // Within first 3 seconds and have previous - go to previous
        Serial.printf("[Audio] Going to previous track (mediaId: %d)\n", prev_media_id);
        audio.stopSong();

        // Swap current and previous
        char temp_url[256];
        strncpy(temp_url, current_url, sizeof(temp_url) - 1);
        int temp_id = current_media_id;

        strncpy(current_url, prev_url, sizeof(current_url) - 1);
        current_media_id = prev_media_id;
        track_start_time = millis();

        strncpy(prev_url, temp_url, sizeof(prev_url) - 1);
        prev_media_id = temp_id;

        audio.connecttohost(current_url);
        state = AUDIO_PLAYING;
        emit_status("playing");
    }
}

static void handle_play_soundmachine(const char* url, const char* name) {
    Serial.printf("[Audio] Starting sound machine mode: %s (%s)\n", name, url);

    // Stop any current playback
    audio.stopSong();
    clear_queue_internal();

    // Enable sound machine mode
    soundmachine_mode = true;
    strncpy(soundmachine_url, url, sizeof(soundmachine_url) - 1);
    strncpy(soundmachine_name, name, sizeof(soundmachine_name) - 1);

    // Clear current track info (sound machine doesn't use media IDs)
    current_media_id = -1;
    current_url[0] = '\0';

    // Start playing
    audio.connecttohost(url);
    state = AUDIO_PLAYING;
}

static void handle_stop_soundmachine() {
    if (soundmachine_mode) {
        Serial.println("[Audio] Stopping sound machine mode");
        soundmachine_mode = false;
        soundmachine_url[0] = '\0';
        soundmachine_name[0] = '\0';
        audio.stopSong();
        state = AUDIO_IDLE;
    }
}

static void process_command(const AudioCommand& cmd) {
    switch (cmd.type) {
        case CMD_PLAY_URL:
            handle_play_url(cmd.url, cmd.mediaId);
            break;
        case CMD_QUEUE_URL:
            handle_queue_url(cmd.url, cmd.mediaId);
            break;
        case CMD_PLAY_SYSTEM_SOUND:
            handle_play_system_sound(cmd.soundType);
            break;
        case CMD_PAUSE:
            handle_pause();
            break;
        case CMD_RESUME:
            handle_resume();
            break;
        case CMD_STOP:
            handle_stop();
            break;
        case CMD_SET_VOLUME:
            handle_set_volume(cmd.volume);
            break;
        case CMD_SKIP_NEXT:
            handle_skip_next();
            break;
        case CMD_SKIP_PREV:
            handle_skip_prev();
            break;
        case CMD_CLEAR_QUEUE:
            clear_queue_internal();
            break;
        case CMD_PLAY_SOUNDMACHINE:
            handle_play_soundmachine(cmd.url, cmd.name);
            break;
        case CMD_STOP_SOUNDMACHINE:
            handle_stop_soundmachine();
            break;
    }
}

// Audio task runs on Core 0, processes commands and runs audio loop
static void audioTask(void* parameter) {
    Serial.println("[Audio] Task started on Core 0");
    AudioCommand cmd;

    for (;;) {
        // Process any pending commands (non-blocking)
        while (xQueueReceive(commandQueue, &cmd, 0) == pdTRUE) {
            process_command(cmd);
        }

        // Run audio loop
        audio.loop();
        vTaskDelay(1);  // Small yield to prevent watchdog
    }
}

// Helper to send command to audio task
static void send_command(const AudioCommand& cmd) {
    if (commandQueue == NULL) {
        Serial.println("[Audio] Command queue not initialized!");
        return;
    }

    // Try to send, don't block if queue is full
    if (xQueueSend(commandQueue, &cmd, 0) != pdTRUE) {
        Serial.println("[Audio] Command queue full, dropping command");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API (can be called from any core)
// ─────────────────────────────────────────────────────────────────────────────

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

    // Create command queue
    commandQueue = xQueueCreate(COMMAND_QUEUE_SIZE, sizeof(AudioCommand));
    if (commandQueue == NULL) {
        Serial.println("[Audio] Failed to create command queue");
        return false;
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

    Serial.println("[Audio] Ready (task on Core 0, command queue enabled)");
    return true;
}

void audio_play_startup_sound() {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SYSTEM_SOUND;
    cmd.soundType = SOUND_TYPE_STARTUP;
    send_command(cmd);
}

void audio_play_card_scan_sound() {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SYSTEM_SOUND;
    cmd.soundType = SOUND_TYPE_CARD_SCAN;
    send_command(cmd);
}

void audio_play_error_sound() {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SYSTEM_SOUND;
    cmd.soundType = SOUND_TYPE_ERROR;
    send_command(cmd);
}

void audio_play_url(const char* url, int mediaId) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_URL;
    strncpy(cmd.url, url, sizeof(cmd.url) - 1);
    cmd.mediaId = mediaId;
    send_command(cmd);
}

void audio_queue_url(const char* url, int mediaId) {
    AudioCommand cmd = {};
    cmd.type = CMD_QUEUE_URL;
    strncpy(cmd.url, url, sizeof(cmd.url) - 1);
    cmd.mediaId = mediaId;
    send_command(cmd);
}

void audio_clear_queue() {
    AudioCommand cmd = {};
    cmd.type = CMD_CLEAR_QUEUE;
    send_command(cmd);
}

void audio_pause() {
    AudioCommand cmd = {};
    cmd.type = CMD_PAUSE;
    send_command(cmd);
}

void audio_resume() {
    AudioCommand cmd = {};
    cmd.type = CMD_RESUME;
    send_command(cmd);
}

void audio_stop() {
    AudioCommand cmd = {};
    cmd.type = CMD_STOP;
    send_command(cmd);
}

void audio_skip_next() {
    AudioCommand cmd = {};
    cmd.type = CMD_SKIP_NEXT;
    send_command(cmd);
}

void audio_skip_prev() {
    AudioCommand cmd = {};
    cmd.type = CMD_SKIP_PREV;
    send_command(cmd);
}

void audio_play_soundmachine(const char* url, const char* name) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SOUNDMACHINE;
    strncpy(cmd.url, url, sizeof(cmd.url) - 1);
    strncpy(cmd.name, name, sizeof(cmd.name) - 1);
    send_command(cmd);
}

void audio_stop_soundmachine() {
    AudioCommand cmd = {};
    cmd.type = CMD_STOP_SOUNDMACHINE;
    send_command(cmd);
}

bool audio_is_soundmachine_mode() {
    return soundmachine_mode;
}

void audio_set_volume(int level) {
    AudioCommand cmd = {};
    cmd.type = CMD_SET_VOLUME;
    cmd.volume = level;
    send_command(cmd);
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

void audio_on_playback_status(PlaybackStatusCallback callback) {
    on_playback_status = callback;
}


// ESP32-audioI2S callback - called when track ends (runs on Core 0)
void audio_eof_mp3(const char* info) {
    Serial.printf("[Audio] Track ended: %s\n", info);

    // Sound machine mode - loop the sound
    if (soundmachine_mode) {
        Serial.printf("[Audio] Sound machine looping: %s\n", soundmachine_name);
        audio.connecttohost(soundmachine_url);
        return;
    }

    if (playing_system_sound) {
        playing_system_sound = false;

        // Check if there's a pending URL to play
        if (pending_url[0] != '\0') {
            Serial.printf("[Audio] Playing pending URL: %s\n", pending_url);

            // Save current as previous before replacing
            if (current_url[0] != '\0' && current_media_id >= 0) {
                strncpy(prev_url, current_url, sizeof(prev_url) - 1);
                prev_media_id = current_media_id;
            }

            strncpy(current_url, pending_url, sizeof(current_url) - 1);
            current_media_id = pending_media_id;
            track_start_time = millis();

            audio.connecttohost(pending_url);
            pending_url[0] = '\0';
            pending_media_id = -1;
            state = AUDIO_PLAYING;
            emit_status("playing");
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
