#include "audio_player.h"
#include "device_config.h"
#include "sd_cache.h"
#include <Arduino.h>
#include <SD.h>
#include <HTTPClient.h>
#include "Audio.h"

// I2S pins for MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

// FreeRTOS task for audio processing on Core 0
static TaskHandle_t audioTaskHandle = NULL;

// System sound files (on SD card)
#define SOUNDS_DIR "/sounds"
#define SOUND_STARTUP "/sounds/startup.mp3"
#define SOUND_CARD_SCAN "/sounds/scan.mp3"
#define SOUND_ERROR "/sounds/error.mp3"

// Server paths for downloading sounds
#define SOUND_URL_STARTUP "/api/sounds/startup.mp3"
#define SOUND_URL_SCAN "/api/sounds/scan.mp3"
#define SOUND_URL_ERROR "/api/sounds/error.mp3"

// ─────────────────────────────────────────────────────────────────────────────
// Command queue for thread-safe audio control
// All audio operations are sent to Core 0 via this queue
// ─────────────────────────────────────────────────────────────────────────────

enum CommandType {
    CMD_PLAY_URL,
    CMD_QUEUE_URL,
    CMD_PLAY_SD_FILE,
    CMD_QUEUE_SD_FILE,
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

// Command queue - holds up to 60 pending commands (enough for 50-track playlist + extras)
static QueueHandle_t commandQueue = NULL;
#define COMMAND_QUEUE_SIZE 60

// ─────────────────────────────────────────────────────────────────────────────
// Playback queue for gapless playback
// ─────────────────────────────────────────────────────────────────────────────

#define MAX_QUEUE_SIZE 50

struct QueueItem {
    char url[256];
    int mediaId;
    bool isFile;  // true = SD file path, false = URL
};

// Audio instance
static Audio audio;

// State (only modified on Core 0)
static volatile AudioState state = AUDIO_IDLE;
static volatile int current_media_id = -1;
static bool current_is_sd_file = false;
static int current_volume = 10;
static int max_volume = 42;  // Default: no limit
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

// Pending item to play after system sound
static char pending_url[256] = {0};
static int pending_media_id = -1;
static bool pending_is_sd_file = false;

// Deferred playback - set in callback, handled in loop
static volatile bool deferred_play_pending = false;
static volatile bool deferred_play_next_queue = false;
static volatile bool deferred_loop_soundmachine = false;

// Delay after starting system sound to let audio library initialize
static unsigned long system_sound_start_time = 0;
#define SYSTEM_SOUND_INIT_DELAY_MS 50

// Current track info for restart/previous
static char current_url[256] = {0};
static unsigned long track_start_time = 0;

// History for previous track (simple single-track history)
static char prev_url[256] = {0};
static int prev_media_id = -1;
static bool prev_is_sd_file = false;

// Callbacks
static TrackEndedCallback on_track_ended = nullptr;
static QueueEmptyCallback on_queue_empty = nullptr;
static PlaybackStatusCallback on_playback_status = nullptr;

// ─────────────────────────────────────────────────────────────────────────────
// Internal functions (run on Core 0)
// ─────────────────────────────────────────────────────────────────────────────

// Download a file from server to SD card (skips if already exists)
static bool downloadSoundToSD(const char* urlPath, const char* sdPath) {
    // Skip if file already exists on SD
    if (SD.exists(sdPath)) {
        return true;
    }

    char fullUrl[256];
    snprintf(fullUrl, sizeof(fullUrl), "%s%s", config_stream_base_url(), urlPath);

    Serial.printf("[Audio] Downloading %s...\n", fullUrl);

    HTTPClient http;
    http.begin(fullUrl);
    http.setTimeout(30000);

    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[Audio] Download failed: HTTP %d\n", httpCode);
        http.end();
        return false;
    }

    File dstFile = SD.open(sdPath, FILE_WRITE);
    if (!dstFile) {
        Serial.printf("[Audio] Failed to create SD file: %s\n", sdPath);
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    uint8_t buf[512];
    size_t totalBytes = 0;
    int contentLength = http.getSize();

    while (http.connected() && (contentLength > 0 || contentLength == -1)) {
        size_t available = stream->available();
        if (available) {
            size_t bytesRead = stream->readBytes(buf, min(available, sizeof(buf)));
            dstFile.write(buf, bytesRead);
            totalBytes += bytesRead;
            if (contentLength > 0) contentLength -= bytesRead;
        }
        vTaskDelay(1);  // Yield to prevent watchdog timeout
    }

    dstFile.close();
    http.end();

    Serial.printf("[Audio] Downloaded %s (%lu bytes)\n", sdPath, (unsigned long)totalBytes);
    return true;
}

// Download system sounds from server to SD card
static void downloadSoundsToSD() {
    // Create sounds directory if it doesn't exist
    if (!SD.exists(SOUNDS_DIR)) {
        SD.mkdir(SOUNDS_DIR);
        Serial.println("[Audio] Created /sounds directory on SD");
    }

    // Download each sound file
    downloadSoundToSD(SOUND_URL_STARTUP, SOUND_STARTUP);
    downloadSoundToSD(SOUND_URL_SCAN, SOUND_CARD_SCAN);
    downloadSoundToSD(SOUND_URL_ERROR, SOUND_ERROR);
}

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
    pending_is_sd_file = false;
    Serial.println("[Audio] Queue cleared");
}

static void play_next_in_queue() {
    // Use loop instead of recursion to avoid stack overflow with many corrupt files
    while (queue_count > 0) {
        QueueItem* item = &playQueue[queue_head];
        queue_head = (queue_head + 1) % MAX_QUEUE_SIZE;
        queue_count--;

        Serial.printf("[Audio] Playing next: %s (%s, remaining: %d)\n",
            item->url, item->isFile ? "SD" : "URL", queue_count);

        // Save current as previous before replacing
        if (current_url[0] != '\0' && current_media_id >= 0) {
            strncpy(prev_url, current_url, sizeof(prev_url) - 1);
            prev_media_id = current_media_id;
            prev_is_sd_file = current_is_sd_file;
        }

        // Save new current track info
        strncpy(current_url, item->url, sizeof(current_url) - 1);
        current_media_id = item->mediaId;
        current_is_sd_file = item->isFile;
        track_start_time = millis();

        if (item->isFile) {
            Serial.printf("[Audio] Playing from SD: %s\n", item->url);
            // Don't call stopSong() - connecttoFS calls setDefaults() which calls it

            if (!audio.connecttoFS(SD, item->url)) {
                Serial.printf("[Audio] connecttoFS failed: %s - skipping\n", item->url);
                sd_cache_remove(item->mediaId);
                continue;  // Try next item in queue
            }
        } else {
            audio.connecttohost(item->url);
        }
        state = AUDIO_PLAYING;
        emit_status("playing");
        return;  // Successfully started playback
    }

    // Queue exhausted
    Serial.println("[Audio] Queue empty");
    emit_status("finished");
    state = AUDIO_IDLE;
    current_media_id = -1;
    current_is_sd_file = false;
    if (on_queue_empty) {
        on_queue_empty();
    }
}

static void handle_play_system_sound(SystemSoundType soundType) {
    const char* soundFile = nullptr;

    switch (soundType) {
        case SOUND_TYPE_STARTUP: soundFile = SOUND_STARTUP; break;
        case SOUND_TYPE_CARD_SCAN: soundFile = SOUND_CARD_SCAN; break;
        case SOUND_TYPE_ERROR: soundFile = SOUND_ERROR; break;
    }

    if (!soundFile) return;

    // Error sound should stop current playback and clear the queue
    // (error means something went wrong, don't continue with queued items)
    if (soundType == SOUND_TYPE_ERROR) {
        audio.stopSong();
        clear_queue_internal();
        pending_url[0] = '\0';
        pending_media_id = -1;
    }

    // Play from SD only - no HTTP fallback
    // System sounds are downloaded to SD on first boot
    if (!SD.exists(soundFile)) {
        Serial.printf("[Audio] System sound not on SD: %s (skipping)\n", soundFile);
        return;
    }

    Serial.printf("[Audio] Playing system sound from SD: %s\n", soundFile);
    audio.connecttoFS(SD, soundFile);
    playing_system_sound = true;
    system_sound_start_time = millis();
    state = AUDIO_PLAYING;
}

static void handle_play_url(const char* url, int mediaId) {
    // If playing system sound, queue this as pending
    // Still clear the queue - play command means "start fresh"
    if (playing_system_sound) {
        clear_queue_internal();
        strncpy(pending_url, url, sizeof(pending_url) - 1);
        pending_media_id = mediaId;
        pending_is_sd_file = false;
        Serial.printf("[Audio] Queued pending URL: %s (queue cleared)\n", url);
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
        prev_is_sd_file = current_is_sd_file;
    }

    // Save new current track info
    strncpy(current_url, url, sizeof(current_url) - 1);
    current_media_id = mediaId;
    current_is_sd_file = false;
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
    playQueue[queue_tail].isFile = false;
    queue_tail = (queue_tail + 1) % MAX_QUEUE_SIZE;
    queue_count++;

    Serial.printf("[Audio] Queued URL: %s (queue size: %d)\n", url, queue_count);

    // If not playing, start the queue
    if (state == AUDIO_IDLE && !playing_system_sound) {
        play_next_in_queue();
    }
}

static void handle_play_sd_file(const char* path, int mediaId) {
    // If playing system sound, queue this as pending
    // Still clear the queue - play command means "start fresh"
    if (playing_system_sound) {
        clear_queue_internal();
        strncpy(pending_url, path, sizeof(pending_url) - 1);
        pending_media_id = mediaId;
        pending_is_sd_file = true;
        Serial.printf("[Audio] Queued pending SD file: %s (queue cleared)\n", path);
        return;
    }

    // Clear any existing queue
    clear_queue_internal();

    Serial.printf("[Audio] Playing SD file: %s (mediaId: %d)\n", path, mediaId);
    // Don't call stopSong() - connecttoFS calls setDefaults() which calls it

    // Save current as previous before replacing
    if (current_url[0] != '\0' && current_media_id >= 0) {
        strncpy(prev_url, current_url, sizeof(prev_url) - 1);
        prev_media_id = current_media_id;
        prev_is_sd_file = current_is_sd_file;
    }

    // Save new current track info
    strncpy(current_url, path, sizeof(current_url) - 1);
    current_media_id = mediaId;
    current_is_sd_file = true;
    track_start_time = millis();

    if (!audio.connecttoFS(SD, path)) {
        Serial.printf("[Audio] connecttoFS failed for: %s\n", path);
        sd_cache_remove(mediaId);
        state = AUDIO_IDLE;
        return;
    }
    state = AUDIO_PLAYING;
    emit_status("playing");
}

static void handle_queue_sd_file(const char* path, int mediaId) {
    if (queue_count >= MAX_QUEUE_SIZE) {
        Serial.println("[Audio] Queue full, dropping track");
        return;
    }

    strncpy(playQueue[queue_tail].url, path, sizeof(playQueue[queue_tail].url) - 1);
    playQueue[queue_tail].mediaId = mediaId;
    playQueue[queue_tail].isFile = true;
    queue_tail = (queue_tail + 1) % MAX_QUEUE_SIZE;
    queue_count++;

    Serial.printf("[Audio] Queued SD file: %s (queue size: %d)\n", path, queue_count);

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
    system_sound_start_time = 0;
    Serial.println("[Audio] Stopped");
    if (stoppedMediaId >= 0) {
        emit_status("stopped");
    }
}

static void handle_set_volume(int level) {
    if (level < 0) level = 0;
    if (level > 21) level = 21;
    // Enforce max volume limit
    if (level > max_volume) {
        level = max_volume;
        Serial.printf("[Audio] Volume clamped to max: %d\n", max_volume);
    }
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
            if (current_is_sd_file) {
                audio.connecttoFS(SD, current_url);
            } else {
                audio.connecttohost(current_url);
            }
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
        bool temp_is_sd = current_is_sd_file;

        strncpy(current_url, prev_url, sizeof(current_url) - 1);
        current_media_id = prev_media_id;
        current_is_sd_file = prev_is_sd_file;
        track_start_time = millis();

        strncpy(prev_url, temp_url, sizeof(prev_url) - 1);
        prev_media_id = temp_id;
        prev_is_sd_file = temp_is_sd;

        if (current_is_sd_file) {
            audio.connecttoFS(SD, current_url);
        } else {
            audio.connecttohost(current_url);
        }
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
        deferred_loop_soundmachine = false;
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
        case CMD_PLAY_SD_FILE:
            handle_play_sd_file(cmd.url, cmd.mediaId);
            break;
        case CMD_QUEUE_SD_FILE:
            handle_queue_sd_file(cmd.url, cmd.mediaId);
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

// Flag to trigger sound download (set from main after WiFi connects)
static volatile bool download_sounds_requested = false;

// Audio task runs on Core 0, processes commands and runs audio loop
static void audioTask(void* parameter) {
    Serial.println("[Audio] Task started on Core 0");

    // Initialize SD card on Core 0 - MUST be same core that accesses it
    Serial.println("[Audio] Initializing SD card on Core 0...");
    sd_cache_init();

    // Sounds will be downloaded after WiFi connects (via audio_download_sounds())

    AudioCommand cmd;

    for (;;) {
        // Process ONE command per loop iteration (non-blocking)
        // This prevents overwhelming the audio library when rapid commands arrive
        // Skip command processing briefly after system sound starts to let audio initialize
        bool can_process_commands = true;
        if (playing_system_sound && system_sound_start_time > 0) {
            unsigned long elapsed = millis() - system_sound_start_time;
            if (elapsed < SYSTEM_SOUND_INIT_DELAY_MS) {
                can_process_commands = false;
            }
        }

        if (can_process_commands && xQueueReceive(commandQueue, &cmd, 0) == pdTRUE) {
            process_command(cmd);
        }

        // Run audio loop
        audio.loop();

        // Fix: detect when audio finished but callback wasn't triggered
        // Don't check immediately after starting - audio needs time to buffer
        bool can_check_running = true;
        if (system_sound_start_time > 0) {
            unsigned long elapsed = millis() - system_sound_start_time;
            if (elapsed < SYSTEM_SOUND_INIT_DELAY_MS) {
                can_check_running = false;
            }
        }

        if (playing_system_sound && can_check_running && !audio.isRunning()) {
            Serial.println("[Audio] System sound finished (detected via isRunning)");
            playing_system_sound = false;
            system_sound_start_time = 0;

            if (pending_url[0] != '\0') {
                deferred_play_pending = true;
            } else if (queue_count > 0) {
                deferred_play_next_queue = true;
            }
            state = AUDIO_IDLE;
        }

        // Handle deferred playback (connecttoFS doesn't work from eof callback)
        if (deferred_play_pending) {
            deferred_play_pending = false;
            Serial.println("[Audio] Processing deferred pending playback");

            // Save current as previous before replacing
            if (current_url[0] != '\0' && current_media_id >= 0) {
                strncpy(prev_url, current_url, sizeof(prev_url) - 1);
                prev_media_id = current_media_id;
            }

            strncpy(current_url, pending_url, sizeof(current_url) - 1);
            current_media_id = pending_media_id;
            current_is_sd_file = pending_is_sd_file;
            track_start_time = millis();

            bool success = false;
            if (pending_is_sd_file) {
                Serial.printf("[Audio] Playing deferred SD file: %s\n", pending_url);
                if (audio.connecttoFS(SD, pending_url)) {
                    success = true;
                } else {
                    Serial.println("[Audio] connecttoFS failed");
                    sd_cache_remove(pending_media_id);
                }
            } else {
                Serial.printf("[Audio] Playing deferred URL: %s\n", pending_url);
                audio.connecttohost(pending_url);
                success = true;
            }

            pending_url[0] = '\0';
            pending_media_id = -1;
            pending_is_sd_file = false;

            if (success) {
                state = AUDIO_PLAYING;
                emit_status("playing");
            } else if (queue_count > 0) {
                // SD file failed, try the queue
                play_next_in_queue();
            } else {
                state = AUDIO_IDLE;
            }
        }

        if (deferred_play_next_queue) {
            deferred_play_next_queue = false;
            Serial.println("[Audio] Processing deferred queue playback");
            play_next_in_queue();
        }

        if (deferred_loop_soundmachine) {
            deferred_loop_soundmachine = false;
            if (soundmachine_mode && soundmachine_url[0] != '\0') {
                Serial.printf("[Audio] Sound machine looping: %s\n", soundmachine_name);
                audio.connecttohost(soundmachine_url);
                state = AUDIO_PLAYING;
            }
        }

        // When idle, process downloads (all SD access on Core 0)
        if (state == AUDIO_IDLE && !playing_system_sound && !soundmachine_mode) {
            // Download system sounds if requested (only when idle to avoid crackling)
            if (download_sounds_requested) {
                download_sounds_requested = false;
                downloadSoundsToSD();
            }

            // Process SD cache downloads
            sd_cache_process();
        }

        vTaskDelay(1);  // Feed watchdog
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

    // SPIFFS will be initialized on Core 0 (same as SD) to avoid cross-core issues

    // Create command queue
    commandQueue = xQueueCreate(COMMAND_QUEUE_SIZE, sizeof(AudioCommand));
    if (commandQueue == NULL) {
        Serial.println("[Audio] Failed to create command queue");
        return false;
    }

    // Initialize I2S audio
    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.forceMono(true);  // Mix L+R for single speaker setup
    audio.setVolumeSteps(42);
    audio.setVolume(current_volume);
    audio.setConnectionTimeout(2000, 2700);

    // Start audio task on Core 0 (main loop runs on Core 1)
    xTaskCreatePinnedToCore(
        audioTask,          // Task function
        "AudioTask",        // Name
        16384,              // Stack size
        NULL,               // Parameters
        configMAX_PRIORITIES - 1,  // High priority
        &audioTaskHandle,   // Task handle
        0                   // Core 0
    );

    Serial.println("[Audio] Ready (task on Core 0, command queue enabled)");
    return true;
}

void audio_download_sounds() {
    // Trigger sound download on audio task (must run on Core 0)
    download_sounds_requested = true;
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

void audio_play_sd_file(const char* path, int mediaId) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SD_FILE;
    strncpy(cmd.url, path, sizeof(cmd.url) - 1);
    cmd.mediaId = mediaId;
    send_command(cmd);
}

void audio_queue_sd_file(const char* path, int mediaId) {
    AudioCommand cmd = {};
    cmd.type = CMD_QUEUE_SD_FILE;
    strncpy(cmd.url, path, sizeof(cmd.url) - 1);
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

void audio_set_max_volume(int level) {
    if (level < 0) level = 0;
    if (level > 21) level = 21;
    max_volume = level;
    Serial.printf("[Audio] Max volume set to: %d\n", max_volume);
    // If current volume exceeds new max, reduce it
    if (current_volume > max_volume) {
        current_volume = max_volume;
        audio.setVolume(current_volume);
        Serial.printf("[Audio] Current volume reduced to max: %d\n", current_volume);
    }
}

int audio_get_max_volume() {
    return max_volume;
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
// IMPORTANT: Don't call connecttoFS from here - it causes timeout issues
// Instead, set flags and let the audio loop handle playback
void audio_eof_mp3(const char* info) {
    Serial.printf("[Audio] Track ended: %s\n", info);

    // Sound machine mode - defer looping to the main audio loop
    // (connecttohost from within the EOF callback is unreliable)
    if (soundmachine_mode) {
        Serial.printf("[Audio] Sound machine track ended, deferring loop: %s\n", soundmachine_name);
        deferred_loop_soundmachine = true;
        return;
    }

    if (playing_system_sound) {
        playing_system_sound = false;
        system_sound_start_time = 0;

        // Check if there's a pending item to play
        if (pending_url[0] != '\0') {
            // Defer the actual playback to the audio loop
            Serial.println("[Audio] Deferring pending item playback to loop");
            deferred_play_pending = true;
            state = AUDIO_IDLE;  // Temporarily idle so loop processes it
            return;
        }

        // Check if there's a queue
        if (queue_count > 0) {
            deferred_play_next_queue = true;
            state = AUDIO_IDLE;
            return;
        }

        state = AUDIO_IDLE;
        return;
    }

    // Notify callback
    if (on_track_ended) {
        on_track_ended();
    }

    // Defer queue playback to the audio loop
    if (queue_count > 0) {
        deferred_play_next_queue = true;
        state = AUDIO_IDLE;
    } else {
        emit_status("finished");
        state = AUDIO_IDLE;
        current_media_id = -1;
        current_is_sd_file = false;
        if (on_queue_empty) {
            on_queue_empty();
        }
    }
}
