#include <Arduino.h>
#include <Button2.h>
#include <esp_task_wdt.h>
#include "device_config.h"
#include "provisioning.h"
#include "logger.h"
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "nfc_reader.h"
#include "audio_player.h"
#include "card_cache.h"
#include "sd_cache.h"
#include "ota_updater.h"

// Button pins
#define BTN_PLAY   11
#define BTN_VOL_UP 13
#define BTN_VOL_DN 14
#define BTN_NEXT   12
#define BTN_PREV   10

// Watchdog timeout (seconds)
#define WDT_TIMEOUT 30

Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

// Device state
static bool mqtt_broker_found = false;
static bool device_approved = false;
static bool device_ready = false;  // WiFi + MQTT + approved
static bool previously_approved = false;  // Was approved in a previous session

// Sound machine state
static bool sound_machine_active = false;

// Combo: hold vol up + vol down — restart on release after 2s, factory reset at 5s
static unsigned long both_vol_pressed_start = 0;
#define RESTART_HOLD_MS       2000
#define FACTORY_RESET_HOLD_MS 5000

// ─────────────────────────────────────────────────────────────────────────────
// Restart reason logging
// ─────────────────────────────────────────────────────────────────────────────

static void log_restart_reason() {
    esp_reset_reason_t reason = esp_reset_reason();
    const char* reason_str = "UNKNOWN";

    switch (reason) {
        case ESP_RST_POWERON:  reason_str = "Power-on"; break;
        case ESP_RST_EXT:      reason_str = "External reset"; break;
        case ESP_RST_SW:       reason_str = "Software reset"; break;
        case ESP_RST_PANIC:    reason_str = "Panic/exception"; break;
        case ESP_RST_INT_WDT:  reason_str = "Interrupt watchdog"; break;
        case ESP_RST_TASK_WDT: reason_str = "Task watchdog"; break;
        case ESP_RST_WDT:      reason_str = "Other watchdog"; break;
        case ESP_RST_DEEPSLEEP: reason_str = "Deep sleep wake"; break;
        case ESP_RST_BROWNOUT: reason_str = "Brownout"; break;
        case ESP_RST_SDIO:     reason_str = "SDIO"; break;
        default: break;
    }

    LOG_I(MOD_SYS, "Restart reason: %s", reason_str);

    if (reason == ESP_RST_TASK_WDT || reason == ESP_RST_INT_WDT || reason == ESP_RST_WDT) {
        LOG_W(MOD_SYS, "Device restarted due to watchdog timeout");
    }

    if (reason == ESP_RST_PANIC) {
        LOG_E(MOD_SYS, "Device restarted due to panic/exception");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// WiFi callbacks
// ─────────────────────────────────────────────────────────────────────────────

void onWifiConnected() {
    LOG_I(MOD_WIFI, "Connected");

    // Enable remote logging
    logger_set_remote(true);

    // Download system sounds if not already on SD
    static bool sounds_downloaded = false;
    if (!sounds_downloaded) {
        sounds_downloaded = true;
        audio_download_sounds();
    }

    // Discover and connect to MQTT broker
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
    LOG_I(MOD_AUDIO, "Play mediaId=%d", mediaId);
    if (sd_cache_has(mediaId)) {
        String path = sd_cache_path(mediaId);
        LOG_D(MOD_AUDIO, "Using SD cache: %s", path.c_str());
        audio_play_sd_file(path.c_str(), mediaId);
    } else {
        audio_play_url(url, mediaId);
        sd_cache_queue_download(mediaId, url);
    }
}

void onQueueTrack(const char* url, int mediaId) {
    LOG_D(MOD_AUDIO, "Queue mediaId=%d", mediaId);
    if (sd_cache_has(mediaId)) {
        String path = sd_cache_path(mediaId);
        audio_queue_sd_file(path.c_str(), mediaId);
    } else {
        audio_queue_url(url, mediaId);
        sd_cache_queue_download(mediaId, url);
    }
}

void onPause() {
    LOG_D(MOD_AUDIO, "Pause");
    audio_pause();
}

void onResume() {
    LOG_D(MOD_AUDIO, "Resume");
    audio_resume();
}

void onStop() {
    LOG_D(MOD_AUDIO, "Stop");
    audio_stop();
}

void onVolume(int level) {
    LOG_D(MOD_AUDIO, "Volume=%d", level);
    audio_set_volume(level);
}

void onOta(const char* url, const char* version, const char* sha256) {
    LOG_I(MOD_OTA, "Update available: v%s", version);

    if (audio_get_state() != AUDIO_IDLE) {
        LOG_I(MOD_OTA, "Stopping audio for update");
        audio_stop();
        delay(500);
    }

    nfc_set_enabled(false);
    ota_start_update(url, version, sha256);
}

void onApproved() {
    LOG_I(MOD_SYS, "Device approved by server");
    device_approved = true;
    nfc_set_enabled(true);

    config_set_approved(true);

    if (!device_ready) {
        device_ready = true;
        audio_play_startup_sound();
    }
}

void onErrorSound() {
    LOG_W(MOD_CARD, "Unknown card - playing error sound");
    audio_play_error_sound();
}

void onSoundMachine(const char* url, const char* name, int volume) {
    if (url && name) {
        LOG_I(MOD_AUDIO, "Sound machine: %s", name);
        sound_machine_active = true;
        if (volume >= 0) {
            audio_set_volume(volume);
        }
        audio_play_soundmachine(url, name);
    } else {
        LOG_W(MOD_AUDIO, "No sound machine configured");
    }
}

void onPlaybackStatus(const char* status, int mediaId) {
    LOG_D(MOD_AUDIO, "Status: %s, mediaId=%d", status, mediaId);
    if (mqtt_is_connected()) {
        mqtt_publish_playback_status(status, mediaId, 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Button handlers (Button2 requires this exact signature)
// ─────────────────────────────────────────────────────────────────────────────

void onPlayClick(Button2 &btn) {
    if (sound_machine_active) {
        LOG_D(MOD_BTN, "Stopping sound machine");
        sound_machine_active = false;
        audio_stop_soundmachine();
        return;
    }

    if (audio_get_state() == AUDIO_PLAYING) {
        LOG_D(MOD_BTN, "Pause");
        audio_pause();
    } else if (audio_get_state() == AUDIO_PAUSED) {
        LOG_D(MOD_BTN, "Resume");
        audio_resume();
    }
}

void onPlayLongPress(Button2 &btn) {
    if (sound_machine_active) return;

    if (mqtt_is_connected()) {
        LOG_D(MOD_BTN, "Requesting sound machine");
        mqtt_publish_soundmachine_request();
    } else {
        LOG_W(MOD_BTN, "Cannot start sound machine - offline");
    }
}

void onVolUpClick(Button2 &btn) {
    int vol = audio_get_volume();
    int maxVol = audio_get_max_volume();
    if (vol < maxVol) {
        audio_set_volume(vol + 1);
    }
}

void onVolDnClick(Button2 &btn) {
    int vol = audio_get_volume();
    if (vol > 0) {
        audio_set_volume(vol - 1);
    }
}

void onNextClick(Button2 &btn) {
    LOG_D(MOD_BTN, "Next");
    audio_skip_next();
}

void onPrevClick(Button2 &btn) {
    LOG_D(MOD_BTN, "Previous");
    audio_skip_prev();
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC callback
// ─────────────────────────────────────────────────────────────────────────────

void onCardScanned(const char* uid) {
    CachedCard* cached = card_cache_lookup(uid);
    if (cached && cached->trackCount > 0) {
        LOG_I(MOD_CARD, "Card %s: %d tracks", uid, cached->trackCount);

        if (cached->volume >= 0) {
            audio_set_volume(cached->volume);
        }

        int firstMediaId = cached->mediaIds[0];
        char url[256];
        snprintf(url, sizeof(url), "%s/api/media/stream/%d",
                 config_api_base_url(), firstMediaId);

        if (sd_cache_has(firstMediaId)) {
            String path = sd_cache_path(firstMediaId);
            LOG_D(MOD_CARD, "Playing from SD: %d", firstMediaId);
            audio_play_sd_file(path.c_str(), firstMediaId);
        } else {
            LOG_D(MOD_CARD, "Streaming: %d", firstMediaId);
            audio_play_url(url, firstMediaId);
            sd_cache_queue_download(firstMediaId, url);
        }

        for (int i = 1; i < cached->trackCount; i++) {
            int mediaId = cached->mediaIds[i];
            snprintf(url, sizeof(url), "%s/api/media/stream/%d",
                     config_api_base_url(), mediaId);

            if (sd_cache_has(mediaId)) {
                String path = sd_cache_path(mediaId);
                audio_queue_sd_file(path.c_str(), mediaId);
            } else {
                audio_queue_url(url, mediaId);
                sd_cache_queue_download(mediaId, url);
            }
        }

        if (mqtt_is_connected()) {
            mqtt_publish_card_played_locally(uid);
        }
        return;
    }

    LOG_I(MOD_CARD, "Card %s: not cached, asking server", uid);
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
    Serial.println("\n========== MUSICBOX ==========\n");

    logger_init();
    log_restart_reason();

    // Load config from NVS
    config_init();

    // If not provisioned, start captive portal (blocks until configured)
    if (!config_is_provisioned()) {
        LOG_I(MOD_SYS, "Not provisioned - starting captive portal");
        provisioning_start();  // Restarts device on completion
        return;  // Won't reach here
    }

    // Enable task watchdog (ESP-IDF 5.x API)
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true,
    };
    esp_task_wdt_reconfigure(&wdt_config);
    esp_task_wdt_add(NULL);
    LOG_I(MOD_SYS, "Watchdog enabled (%ds)", WDT_TIMEOUT);

    // Check for previous approval (offline mode)
    previously_approved = config_get()->approved;
    if (previously_approved) {
        LOG_I(MOD_SYS, "Previously approved - offline mode available");
    }

    audio_init();
    card_cache_init();

    // Initialize buttons
    btnPlay.begin(BTN_PLAY, INPUT_PULLUP, true);
    btnVolUp.begin(BTN_VOL_UP, INPUT_PULLUP, true);
    btnVolDn.begin(BTN_VOL_DN, INPUT_PULLUP, true);
    btnNext.begin(BTN_NEXT, INPUT_PULLUP, true);
    btnPrev.begin(BTN_PREV, INPUT_PULLUP, true);

    btnPlay.setClickHandler(onPlayClick);
    btnPlay.setLongClickHandler(onPlayLongPress);
    btnPlay.setLongClickTime(1000);
    btnVolUp.setClickHandler(onVolUpClick);
    btnVolDn.setClickHandler(onVolDnClick);
    btnNext.setClickHandler(onNextClick);
    btnPrev.setClickHandler(onPrevClick);

    nfc_init();
    nfc_on_card_scanned(onCardScanned);

    if (previously_approved) {
        LOG_I(MOD_SYS, "Enabling NFC for offline playback");
        nfc_set_enabled(true);
    }

    audio_on_playback_status(onPlaybackStatus);
    ota_init();

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

    wifi_init(onWifiConnected, onWifiDisconnected);

    LOG_I(MOD_SYS, "Setup complete");
}

void loop() {
    esp_task_wdt_reset();

    wifi_loop();
    mqtt_loop();

    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();

    // Combo: vol up + vol down held
    //   Release after 2s → restart
    //   Hold 5s → factory reset (clears NVS, back to captive portal)
    if (btnVolUp.isPressed() && btnVolDn.isPressed()) {
        if (both_vol_pressed_start == 0) {
            both_vol_pressed_start = millis();
        } else if (millis() - both_vol_pressed_start >= FACTORY_RESET_HOLD_MS) {
            LOG_I(MOD_SYS, "Factory reset (vol up+down held 5s)");
            config_factory_reset();  // Clears NVS and restarts
        }
    } else {
        // Buttons released — check if held long enough for restart
        if (both_vol_pressed_start > 0) {
            unsigned long held = millis() - both_vol_pressed_start;
            if (held >= RESTART_HOLD_MS) {
                LOG_I(MOD_SYS, "Manual restart (vol up+down released after %lums)", held);
                delay(100);
                ESP.restart();
            }
        }
        both_vol_pressed_start = 0;
    }

    nfc_loop();

    // Send buffered logs to server
    static unsigned long last_log_send = 0;
    if (mqtt_is_connected() && logger_has_pending() && millis() - last_log_send > 5000) {
        last_log_send = millis();
        char logBuf[1024];
        int len = logger_get_buffer(logBuf, sizeof(logBuf));
        if (len > 0) {
            mqtt_publish_logs(logBuf);
        }
    }

    // Periodic status (every 30s to reduce noise)
    static unsigned long last_status = 0;
    if (millis() - last_status > 30000) {
        last_status = millis();

        const char* mode = "online";
        if (!wifi_is_connected() || !mqtt_is_connected()) {
            mode = previously_approved ? "offline" : "disconnected";
        }

        LOG_I(MOD_SYS, "%s | wifi=%d mqtt=%d nfc=%d sd=%d(%d) audio=%d up=%lus",
            mode,
            wifi_is_connected() ? 1 : 0,
            mqtt_is_connected() ? 1 : 0,
            nfc_is_ready() ? 1 : 0,
            sd_cache_available() ? 1 : 0,
            sd_cache_file_count(),
            audio_get_state(),
            millis() / 1000);
    }

    delay(10);
}
