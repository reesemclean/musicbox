#include <Arduino.h>
#include <Button2.h>
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "nfc_reader.h"
#include "audio_player.h"
#include "card_cache.h"
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

// ─────────────────────────────────────────────────────────────────────────────
// WiFi callbacks
// ─────────────────────────────────────────────────────────────────────────────

void onWifiConnected() {
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
    audio_play_url(url, mediaId);
}

void onQueueTrack(const char* url, int mediaId) {
    Serial.printf("[Queue] URL: %s, mediaId: %d\n", url, mediaId);
    audio_queue_url(url, mediaId);
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

void onOta(const char* url, const char* version) {
    Serial.printf("[OTA] URL: %s, Version: %s\n", url, version);
    // TODO: Start OTA update (Phase 16)
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
    if (audio_get_state() == AUDIO_PLAYING) {
        audio_pause();
    } else if (audio_get_state() == AUDIO_PAUSED) {
        audio_resume();
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
    // TODO: Skip to next track in queue
}

void onPrevClick(Button2 &btn) {
    Serial.println("[Button] Previous");
    // TODO: Go to previous track or restart current
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC callback
// ─────────────────────────────────────────────────────────────────────────────

void onCardScanned(const char* uid) {
    // Play feedback sound immediately
    audio_play_card_scan_sound();

    // Check cache first for instant playback
    CachedCard* cached = card_cache_lookup(uid);
    if (cached && cached->trackCount > 0) {
        Serial.printf("[Card] Cache hit: %s (%d tracks)\n", uid, cached->trackCount);

        // Set volume if card has specific volume
        if (cached->volume >= 0) {
            audio_set_volume(cached->volume);
        }

        // Build URL and play first track immediately
        char url[128];
        snprintf(url, sizeof(url), "http://%s:%d/api/media/stream/%d",
                 API_HOST, API_PORT, cached->mediaIds[0]);
        audio_play_url(url, cached->mediaIds[0]);

        // Queue remaining tracks
        for (int i = 1; i < cached->trackCount; i++) {
            snprintf(url, sizeof(url), "http://%s:%d/api/media/stream/%d",
                     API_HOST, API_PORT, cached->mediaIds[i]);
            audio_queue_url(url, cached->mediaIds[i]);
        }

        // Still notify server (for logging/UI updates)
        if (mqtt_is_connected()) {
            mqtt_publish_card_scanned(uid);
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
        Serial.printf("[Status] WiFi: %s | MQTT: %s | Approved: %s | NFC: %s | Audio: %s | Uptime: %lus\n",
            wifi_is_connected() ? "connected" : "disconnected",
            mqtt_is_connected() ? "connected" : "disconnected",
            device_approved ? "yes" : "no",
            nfc_is_ready() ? "ready" : "error",
            audio_get_state() == AUDIO_PLAYING ? "playing" :
                (audio_get_state() == AUDIO_PAUSED ? "paused" : "idle"),
            millis() / 1000);
    }

    delay(10);
}
