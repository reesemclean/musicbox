#include "audio_player.h"
#include "flash_store.h"
#include "logger.h"
#include <Arduino.h>
#include <LittleFS.h>
#include "Audio.h"

// I2S pins for MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

// Volume scale: 0..VOLUME_MAX. Single authority for the range — the audio
// library's step count, every clamp, and the server/UI/schema all use it.
#define VOLUME_MAX 42

// How long after starting a source before the liveness check is believed.
// A decoder legitimately reports "not running" while it opens a connection or
// fills its first buffer; checking too early would abort a healthy start.
#define LIVENESS_GRACE_STREAM_MS 3000
#define LIVENESS_GRACE_LOCAL_MS  300

static Audio audio;
static TaskHandle_t audioTaskHandle = NULL;

// ─────────────────────────────────────────────────────────────────────────────
// Command queue — every audio operation crosses onto the audio task through
// here, so the decoder is only ever touched from one core.
// ─────────────────────────────────────────────────────────────────────────────

typedef enum {
    CMD_PLAY_STREAM,
    CMD_PLAY_SYSTEM_SOUND,
    CMD_PLAY_SOUNDMACHINE,
    CMD_STOP_SOUNDMACHINE,
    CMD_PAUSE,
    CMD_RESUME,
    CMD_STOP,
    CMD_SET_VOLUME,
} CommandType;

typedef struct {
    CommandType type;
    char url[256];
    int mediaId;
    int volume;
    SystemSound sound;
} AudioCommand;

#define COMMAND_QUEUE_SIZE 8
static QueueHandle_t commandQueue = NULL;

// ─────────────────────────────────────────────────────────────────────────────
// State — owned by the audio task. Reads from other cores are tolerated for
// the simple scalars, which is why those are volatile.
// ─────────────────────────────────────────────────────────────────────────────

static volatile AudioState state = AUDIO_IDLE;
static volatile AudioMode mode = MODE_NORMAL;
static volatile int current_media_id = -1;

static int current_volume = 10;
static int max_volume = VOLUME_MAX;

static unsigned long source_started_ms = 0;
static unsigned long track_started_ms = 0;

// What to resume after a system sound finishes. The read cue plays the instant
// a card is read, before the server has said what to play, so a play arriving
// mid-cue has to wait rather than be dropped.
static char pending_url[256] = {0};
static int pending_media_id = -1;

// Sound machine source, kept so it can be re-opened each loop.
static char soundmachine_path[128] = {0};

// Set from the decoder's end-of-file callback, acted on in the task loop.
// Re-opening a source from inside that callback is unreliable.
static volatile bool deferred_track_ended = false;

static PlaybackStatusCallback on_playback_status = nullptr;

// ─────────────────────────────────────────────────────────────────────────────
// Internals (audio task only)
// ─────────────────────────────────────────────────────────────────────────────

static void emit_status(const char* status) {
    if (on_playback_status) on_playback_status(status, current_media_id);
}

static void go_idle(const char* status) {
    state = AUDIO_IDLE;
    mode = MODE_NORMAL;
    source_started_ms = 0;
    if (status) emit_status(status);
    current_media_id = -1;
}

static bool start_local(const char* path) {
    if (!path) return false;
    // connecttoFS calls setDefaults(), which stops any current source, so an
    // explicit stopSong() first would be redundant.
    if (!audio.connecttoFS(LittleFS, path)) {
        LOG_E(MOD_AUDIO, "Cannot open %s", path);
        return false;
    }
    source_started_ms = millis();
    return true;
}

static bool start_stream(const char* url) {
    if (state != AUDIO_IDLE) audio.stopSong();
    if (!audio.connecttohost(url)) {
        LOG_E(MOD_AUDIO, "Cannot open stream %s", url);
        return false;
    }
    source_started_ms = millis();
    return true;
}

static void handle_play_stream(const char* url, int mediaId) {
    // A play always leaves sound machine mode. Without this the track-end
    // handling would take the loop branch when the new content finished and
    // silently revert to the sound machine.
    soundmachine_path[0] = '\0';

    if (mode == MODE_SYSTEM_SOUND && state == AUDIO_PLAYING) {
        // Wait for the cue rather than cutting it off — it is what tells the
        // user their card was read.
        strncpy(pending_url, url, sizeof(pending_url) - 1);
        pending_url[sizeof(pending_url) - 1] = '\0';
        pending_media_id = mediaId;
        LOG_D(MOD_AUDIO, "Deferring play until cue finishes");
        return;
    }

    LOG_I(MOD_AUDIO, "Stream mediaId=%d", mediaId);
    current_media_id = mediaId;
    track_started_ms = millis();

    if (!start_stream(url)) {
        go_idle("stopped");
        return;
    }

    mode = MODE_NORMAL;
    state = AUDIO_PLAYING;
    emit_status("playing");
}

static void handle_play_system_sound(SystemSound sound) {
    const char* path = flash_system_sound_path(sound);
    if (!path) {
        LOG_W(MOD_AUDIO, "System sound %d not present", (int)sound);
        return;
    }

    // An error cue means "stop and wait", so it discards anything pending.
    if (sound == SOUND_ERROR) {
        pending_url[0] = '\0';
        pending_media_id = -1;
        soundmachine_path[0] = '\0';
    }

    if (!start_local(path)) return;

    mode = MODE_SYSTEM_SOUND;
    state = AUDIO_PLAYING;
}

static void handle_play_soundmachine(const char* path, int volume) {
    if (!path || path[0] == '\0') {
        LOG_W(MOD_AUDIO, "No sound machine configured");
        return;
    }

    strncpy(soundmachine_path, path, sizeof(soundmachine_path) - 1);
    soundmachine_path[sizeof(soundmachine_path) - 1] = '\0';

    if (volume >= 0) {
        current_volume = volume > max_volume ? max_volume : volume;
        audio.setVolume(current_volume);
    }

    if (!start_local(soundmachine_path)) {
        soundmachine_path[0] = '\0';
        go_idle(NULL);
        return;
    }

    current_media_id = -1;
    mode = MODE_SOUNDMACHINE;
    state = AUDIO_PLAYING;
    LOG_I(MOD_AUDIO, "Sound machine started");
}

static void handle_stop_soundmachine() {
    if (mode != MODE_SOUNDMACHINE) return;
    soundmachine_path[0] = '\0';
    audio.stopSong();
    go_idle(NULL);
    LOG_I(MOD_AUDIO, "Sound machine stopped");
}

static void handle_stop() {
    audio.stopSong();
    pending_url[0] = '\0';
    pending_media_id = -1;
    soundmachine_path[0] = '\0';
    bool wasPlaying = current_media_id >= 0;
    go_idle(wasPlaying ? "stopped" : NULL);
}

static void handle_set_volume(int level) {
    if (level < 0) level = 0;
    if (level > VOLUME_MAX) level = VOLUME_MAX;
    if (level > max_volume) level = max_volume;
    current_volume = level;
    audio.setVolume(level);
    LOG_D(MOD_AUDIO, "Volume %d", level);
}

/**
 * A source finished — decide what follows.
 *
 * Reached from either end-of-source signal (see the task loop), so the two
 * never produce different behaviour.
 */
static void on_source_ended() {
    switch (mode) {
        case MODE_SOUNDMACHINE:
            // Loop. There is no gapless loop available from the decoder, so
            // this re-opens the file; the gap is why the loop is long.
            if (soundmachine_path[0] != '\0' && start_local(soundmachine_path)) {
                state = AUDIO_PLAYING;
            } else {
                go_idle(NULL);
            }
            return;

        case MODE_SYSTEM_SOUND:
            if (pending_url[0] != '\0') {
                char url[256];
                strncpy(url, pending_url, sizeof(url));
                int mediaId = pending_media_id;
                pending_url[0] = '\0';
                pending_media_id = -1;

                mode = MODE_NORMAL;
                current_media_id = mediaId;
                track_started_ms = millis();

                if (start_stream(url)) {
                    state = AUDIO_PLAYING;
                    emit_status("playing");
                } else {
                    go_idle("stopped");
                }
                return;
            }
            // A cue with nothing waiting: fall back to the sound machine if it
            // was interrupted, otherwise go quiet.
            if (soundmachine_path[0] != '\0' && start_local(soundmachine_path)) {
                mode = MODE_SOUNDMACHINE;
                state = AUDIO_PLAYING;
                return;
            }
            go_idle(NULL);
            return;

        case MODE_NORMAL:
            // The whole listen is one connection, so this is the end of it —
            // the end of a track *and* of any playlist it belonged to.
            go_idle("finished");
            return;
    }
}

static void process_command(const AudioCommand& cmd) {
    switch (cmd.type) {
        case CMD_PLAY_STREAM:        handle_play_stream(cmd.url, cmd.mediaId); break;
        case CMD_PLAY_SYSTEM_SOUND:  handle_play_system_sound(cmd.sound); break;
        case CMD_PLAY_SOUNDMACHINE:  handle_play_soundmachine(cmd.url, cmd.volume); break;
        case CMD_STOP_SOUNDMACHINE:  handle_stop_soundmachine(); break;
        case CMD_PAUSE:
            if (state == AUDIO_PLAYING) {
                audio.pauseResume();
                state = AUDIO_PAUSED;
                emit_status("paused");
            }
            break;
        case CMD_RESUME:
            if (state == AUDIO_PAUSED) {
                audio.pauseResume();
                state = AUDIO_PLAYING;
                emit_status("playing");
            }
            break;
        case CMD_STOP:       handle_stop(); break;
        case CMD_SET_VOLUME: handle_set_volume(cmd.volume); break;
    }
}

static void audioTask(void* parameter) {
    LOG_I(MOD_AUDIO, "Audio task started on core %d", xPortGetCoreID());

    // The filesystem is mounted here so that every access to it happens on
    // this task, as with the decoder.
    flash_init();

    AudioCommand cmd;

    for (;;) {
        if (xQueueReceive(commandQueue, &cmd, 0) == pdTRUE) {
            process_command(cmd);
        }

        audio.loop();

        // ── Track-end detection ──────────────────────────────────────────
        // Two independent signals, in every mode. The EOF callback is the
        // fast path but HTTP streams don't reliably deliver it: a connection
        // that dies silently produces no callback at all, and relying on it
        // alone would leave playback wedged in PLAYING for ever with nothing
        // audible and no status emitted. The liveness check is the backstop.
        bool ended = false;

        if (deferred_track_ended) {
            deferred_track_ended = false;
            ended = true;
        } else if (state == AUDIO_PLAYING && source_started_ms > 0) {
            unsigned long grace = (mode == MODE_NORMAL)
                ? LIVENESS_GRACE_STREAM_MS
                : LIVENESS_GRACE_LOCAL_MS;
            if (millis() - source_started_ms > grace && !audio.isRunning()) {
                LOG_D(MOD_AUDIO, "Source ended (liveness)");
                ended = true;
            }
        }

        if (ended) {
            on_source_ended();
        }

        // Flash writes stall the cache and can glitch playback, so they only
        // happen with nothing playing.
        if (state == AUDIO_IDLE && flash_has_pending_work()) {
            flash_process();
        }

        vTaskDelay(1);
    }
}

static void send_command(const AudioCommand& cmd) {
    if (commandQueue == NULL) return;
    if (xQueueSend(commandQueue, &cmd, 0) != pdTRUE) {
        LOG_W(MOD_AUDIO, "Command queue full, dropping command");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API — safe from any core
// ─────────────────────────────────────────────────────────────────────────────

bool audio_init() {
    commandQueue = xQueueCreate(COMMAND_QUEUE_SIZE, sizeof(AudioCommand));
    if (commandQueue == NULL) {
        LOG_E(MOD_AUDIO, "Failed to create command queue");
        return false;
    }

    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.forceMono(true);  // single speaker
    audio.setVolumeSteps(VOLUME_MAX);
    audio.setVolume(current_volume);
    audio.setConnectionTimeout(2000, 2700);

    xTaskCreatePinnedToCore(
        audioTask, "AudioTask", 16384, NULL,
        configMAX_PRIORITIES - 1, &audioTaskHandle, 0);

    LOG_I(MOD_AUDIO, "Audio ready");
    return true;
}

void audio_play_stream(const char* url, int mediaId) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_STREAM;
    strncpy(cmd.url, url, sizeof(cmd.url) - 1);
    cmd.mediaId = mediaId;
    send_command(cmd);
}

void audio_play_system_sound(SystemSound sound) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SYSTEM_SOUND;
    cmd.sound = sound;
    send_command(cmd);
}

void audio_play_soundmachine(const char* path, int volume) {
    AudioCommand cmd = {};
    cmd.type = CMD_PLAY_SOUNDMACHINE;
    strncpy(cmd.url, path, sizeof(cmd.url) - 1);
    cmd.volume = volume;
    send_command(cmd);
}

void audio_stop_soundmachine() {
    AudioCommand cmd = {};
    cmd.type = CMD_STOP_SOUNDMACHINE;
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
    if (level > VOLUME_MAX) level = VOLUME_MAX;
    max_volume = level;
    if (current_volume > max_volume) {
        current_volume = max_volume;
        audio.setVolume(current_volume);
    }
    LOG_I(MOD_AUDIO, "Max volume %d", max_volume);
}

int audio_get_max_volume() {
    return max_volume;
}

AudioState audio_get_state() {
    return state;
}

AudioMode audio_get_mode() {
    return mode;
}

int audio_get_current_media_id() {
    return current_media_id;
}

uint32_t audio_get_elapsed_sec() {
    if (track_started_ms == 0) return 0;
    return (millis() - track_started_ms) / 1000;
}

void audio_on_playback_status(PlaybackStatusCallback callback) {
    on_playback_status = callback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoder callbacks (audio task context)
// ─────────────────────────────────────────────────────────────────────────────

void audio_eof_mp3(const char* info) {
    LOG_D(MOD_AUDIO, "EOF: %s", info);
    // Re-opening a source from inside this callback is unreliable, so the task
    // loop does it.
    deferred_track_ended = true;
}

/**
 * ICY stream metadata.
 *
 * The playlist stream announces each track as it begins, encoded as
 * "<mediaId>|<title>". That is how playback status follows a playlist without
 * a second connection, and how the elapsed clock knows a new track started.
 */
void audio_showstreamtitle(const char* info) {
    if (!info) return;
    LOG_D(MOD_AUDIO, "StreamTitle: %s", info);

    const char* sep = strchr(info, '|');
    if (!sep || sep == info) return;

    char idBuf[12];
    size_t idLen = (size_t)(sep - info);
    if (idLen >= sizeof(idBuf)) return;
    memcpy(idBuf, info, idLen);
    idBuf[idLen] = '\0';

    char* end = NULL;
    long mediaId = strtol(idBuf, &end, 10);
    if (end == idBuf || *end != '\0') return;

    current_media_id = (int)mediaId;
    track_started_ms = millis();
    emit_status("playing");
}
