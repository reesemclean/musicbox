#include <Arduino.h>
#include <Button2.h>
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "nfc_reader.h"
#include "audio_player.h"
#include "card_cache.h"
#include "sd_cache.h"
#include "ota_updater.h"
#include "secrets.h"

// Button pins
#define BTN_PLAY   10
#define BTN_VOL_UP 11
#define BTN_VOL_DN 12
#define BTN_NEXT   13
#define BTN_PREV   14

Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

// Device state
static bool mqtt_broker_found = false;
static bool device_approved = false;
static bool device_ready = false;  // WiFi + MQTT + approved

// Sound machine state
static bool sound_machine_active = false;

// ─────────────────────────────────────────────────────────────────────────────
// WiFi callbacks
// ─────────────────────────────────────────────────────────────────────────────

void onWifiConnected() {
    // Download system sounds if not already on SD
    static bool sounds_downloaded = false;
    if (!sounds_downloaded) {
        sounds_downloaded = true;
        audio_download_sounds();
    }

    // Check for firmware updates on WiFi connect (non-blocking)
    static bool update_checked = false;
    if (!update_checked) {
        update_checked = true;
        ota_check_for_update();
    }

    // Try to discover and connect to MQTT broker
    if (!mqtt_broker_found) {
        mqtt_broker_found = mqtt_discover_broker();
    }
    if (mqtt_broker_found && !mqtt_is_connected()) {
        mqtt_connect();
    }
}

void onWifiDisconnected() {
    // Nothing special needed - wifi_manager handles reconnection
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT command callbacks
// ─────────────────────────────────────────────────────────────────────────────

void onPlay(const char* url, int mediaId) {
    Serial.printf("[Play] URL: %s, mediaId: %d\n", url, mediaId);
    // Prefer SD cache if available
    if (sd_cache_has(mediaId)) {
        String path = sd_cache_path(mediaId);
        Serial.printf("[Play] Using SD cache: %s\n", path.c_str());
        audio_play_sd_file(path.c_str(), mediaId);
    } else {
        audio_play_url(url, mediaId);
        // Queue for background download
        sd_cache_queue_download(mediaId, url);
    }
}

void onQueueTrack(const char* url, int mediaId) {
    Serial.printf("[Queue] URL: %s, mediaId: %d\n", url, mediaId);
    // Prefer SD cache if available
    if (sd_cache_has(mediaId)) {
        String path = sd_cache_path(mediaId);
        Serial.printf("[Queue] Using SD cache: %s\n", path.c_str());
        audio_queue_sd_file(path.c_str(), mediaId);
    } else {
        audio_queue_url(url, mediaId);
        // Queue for background download
        sd_cache_queue_download(mediaId, url);
    }
}

void onPause() {
    Serial.println("[Pause]");
    audio_pause();
}

void onResume() {
    Serial.println("[Resume]");
    audio_resume();
}

void onStop() {
    Serial.println("[Stop]");
    audio_stop();
}

void onVolume(int level) {
    Serial.printf("[Volume] Level: %d\n", level);
    audio_set_volume(level);
}

void onOta(const char* url, const char* version, const char* sha256) {
    Serial.printf("[OTA] Received update command: %s (version %s)\n", url, version);
    if (sha256) {
        Serial.printf("[OTA] SHA256: %.16s...\n", sha256);
    }

    // Stop any audio playback before updating
    if (audio_get_state() != AUDIO_IDLE) {
        Serial.println("[OTA] Stopping audio for update...");
        audio_stop();
        delay(500);
    }

    // Disable NFC during update
    nfc_set_enabled(false);

    // Start the OTA update with SHA256 verification
    ota_start_update(url, version, sha256);
}

void onApproved() {
    Serial.println("[Approved] Device approved by server");
    device_approved = true;
    nfc_set_enabled(true);

    // Device is now fully ready
    if (!device_ready) {
        device_ready = true;
        audio_play_startup_sound();
    }
}

void onErrorSound() {
    Serial.println("[Error] Unknown card - playing error sound");
    audio_play_error_sound();
}

void onSoundMachine(const char* url, const char* name, int volume) {
    if (url && name) {
        Serial.printf("[Sound Machine] Starting: %s (volume: %d)\n", name, volume);
        sound_machine_active = true;
        // Set volume if specified (>= 0)
        if (volume >= 0) {
            audio_set_volume(volume);
        }
        audio_play_soundmachine(url, name);
    } else {
        Serial.println("[Sound Machine] No sound configured for this device");
    }
}

void onPlaybackStatus(const char* status, int mediaId) {
    Serial.printf("[Playback] Status: %s, mediaId: %d\n", status, mediaId);
    if (mqtt_is_connected()) {
        mqtt_publish_playback_status(status, mediaId, 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handlers (Button2 requires this exact signature)
// ─────────────────────────────────────────────────────────────────────────────

void onPlayClick(Button2 &btn) {
    Serial.println("[Button] Play/Pause");

    // If sound machine is active, short press stops it
    if (sound_machine_active) {
        Serial.println("[Button] Stopping sound machine");
        sound_machine_active = false;
        audio_stop_soundmachine();
        return;
    }

    if (audio_get_state() == AUDIO_PLAYING) {
        audio_pause();
    } else if (audio_get_state() == AUDIO_PAUSED) {
        audio_resume();
    }
}

void onPlayLongPress(Button2 &btn) {
    Serial.println("[Button] Play long press - requesting sound machine");

    // Don't start sound machine if already active
    if (sound_machine_active) {
        return;
    }

    // Request sound machine config from server via MQTT
    if (mqtt_is_connected()) {
        mqtt_publish_soundmachine_request();
    } else {
        Serial.println("[Button] Cannot start sound machine - MQTT not connected");
    }
}

void onVolUpClick(Button2 &btn) {
    int vol = audio_get_volume();
    if (vol < 21) {
        audio_set_volume(vol + 1);
        Serial.printf("[Button] Volume: %d\n", vol + 1);
    }
}

void onVolDnClick(Button2 &btn) {
    int vol = audio_get_volume();
    if (vol > 0) {
        audio_set_volume(vol - 1);
        Serial.printf("[Button] Volume: %d\n", vol - 1);
    }
}

void onNextClick(Button2 &btn) {
    Serial.println("[Button] Next");
    audio_skip_next();
}

void onPrevClick(Button2 &btn) {
    Serial.println("[Button] Previous");
    audio_skip_prev();
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC callback
// ─────────────────────────────────────────────────────────────────────────────

void onCardScanned(const char* uid) {
    // Music starting is the feedback - no scan sound needed
    // Check cache first for instant playback
    CachedCard* cached = card_cache_lookup(uid);
    if (cached && cached->trackCount > 0) {
        Serial.printf("[Card] Cache hit: %s (%d tracks)\n", uid, cached->trackCount);

        // Set volume if card has specific volume
        if (cached->volume >= 0) {
            audio_set_volume(cached->volume);
        }

        // Play first track - prefer SD cache, fallback to streaming
        int firstMediaId = cached->mediaIds[0];
        char url[128];
        snprintf(url, sizeof(url), "http://%s:%d/api/media/stream/%d",
                 API_HOST, API_PORT, firstMediaId);

        if (sd_cache_has(firstMediaId)) {
            String path = sd_cache_path(firstMediaId);
            Serial.printf("[Card] Playing from SD: %d\n", firstMediaId);
            audio_play_sd_file(path.c_str(), firstMediaId);
        } else {
            Serial.printf("[Card] Streaming: %d\n", firstMediaId);
            audio_play_url(url, firstMediaId);
            // Queue for background download
            sd_cache_queue_download(firstMediaId, url);
        }

        // Queue remaining tracks
        for (int i = 1; i < cached->trackCount; i++) {
            int mediaId = cached->mediaIds[i];
            snprintf(url, sizeof(url), "http://%s:%d/api/media/stream/%d",
                     API_HOST, API_PORT, mediaId);

            if (sd_cache_has(mediaId)) {
                String path = sd_cache_path(mediaId);
                Serial.printf("[Card] Queueing from SD: %d\n", mediaId);
                audio_queue_sd_file(path.c_str(), mediaId);
            } else {
                Serial.printf("[Card] Queueing stream: %d\n", mediaId);
                audio_queue_url(url, mediaId);
                // Queue for background download
                sd_cache_queue_download(mediaId, url);
            }
        }

        // Notify server we handled it locally (for logging/UI) - server won't send play commands
        if (mqtt_is_connected()) {
            mqtt_publish_card_played_locally(uid);
        }
        return;
    }

    // Cache miss - send to server for lookup
    Serial.printf("[Card] Cache miss: %s\n", uid);
    if (mqtt_is_connected()) {
        mqtt_publish_card_scanned(uid);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup & Loop
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== MUSICBOX DEVICE ==========\n");

    // Initialize audio (SPIFFS + I2S)
    // Note: SD card is initialized inside audio task on Core 0
    audio_init();

    // Initialize card cache
    card_cache_init();

    // Initialize buttons (active low with internal pull-up)
    Serial.println("[Buttons] Initializing...");
    btnPlay.begin(BTN_PLAY, INPUT_PULLUP, true);
    btnVolUp.begin(BTN_VOL_UP, INPUT_PULLUP, true);
    btnVolDn.begin(BTN_VOL_DN, INPUT_PULLUP, true);
    btnNext.begin(BTN_NEXT, INPUT_PULLUP, true);
    btnPrev.begin(BTN_PREV, INPUT_PULLUP, true);

    btnPlay.setClickHandler(onPlayClick);
    btnPlay.setLongClickHandler(onPlayLongPress);
    btnPlay.setLongClickTime(1000);  // 1 second for long press
    btnVolUp.setClickHandler(onVolUpClick);
    btnVolDn.setClickHandler(onVolDnClick);
    btnNext.setClickHandler(onNextClick);
    btnPrev.setClickHandler(onPrevClick);
    Serial.println("[Buttons] Ready");

    // Initialize NFC reader
    nfc_init();
    nfc_on_card_scanned(onCardScanned);

    // Register playback status callback
    audio_on_playback_status(onPlaybackStatus);

    // Initialize OTA updater
    ota_init();

    // Initialize MQTT (sets up callbacks and topics)
    mqtt_init();
    mqtt_on_play(onPlay);
    mqtt_on_queue(onQueueTrack);
    mqtt_on_pause(onPause);
    mqtt_on_resume(onResume);
    mqtt_on_stop(onStop);
    mqtt_on_volume(onVolume);
    mqtt_on_ota(onOta);
    mqtt_on_approved(onApproved);
    mqtt_on_error_sound(onErrorSound);
    mqtt_on_soundmachine(onSoundMachine);

    // Initialize WiFi (will trigger onWifiConnected when ready)
    wifi_init(onWifiConnected, onWifiDisconnected);
}

void loop() {
    // Handle WiFi reconnection
    wifi_loop();

    // Handle MQTT
    mqtt_loop();

    // Poll buttons (before NFC which has blocking timeout)
    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();

    // Poll NFC reader
    nfc_loop();

    // Periodic status update
    static unsigned long last_status = 0;
    if (millis() - last_status > 10000) {
        last_status = millis();
        Serial.printf("[Status] WiFi: %s | MQTT: %s | Approved: %s | NFC: %s | Audio: %s | SD: %s (%d files) | Uptime: %lus\n",
            wifi_is_connected() ? "connected" : "disconnected",
            mqtt_is_connected() ? "connected" : "disconnected",
            device_approved ? "yes" : "no",
            nfc_is_ready() ? "ready" : "error",
            audio_get_state() == AUDIO_PLAYING ? "playing" :
                (audio_get_state() == AUDIO_PAUSED ? "paused" : "idle"),
            sd_cache_available() ? "ready" : "unavailable",
            sd_cache_file_count(),
            millis() / 1000);
    }

    delay(10);
}
