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
#include "flash_store.h"
#include "ota_updater.h"

// Button pins
#define BTN_PLAY   11
#define BTN_VOL_UP 13
#define BTN_VOL_DN 14
#define BTN_NEXT   12
#define BTN_PREV   10

#define WDT_TIMEOUT 30

// How long to wait for the server to say what a card maps to before telling
// the user nothing is coming. The device holds no card mapping of its own, so
// every scan needs this round trip.
#define CARD_RESOLVE_TIMEOUT_MS 3000

// Max time to wait for the audio task to acknowledge a stop before an OTA.
#define OTA_AUDIO_STOP_TIMEOUT_MS 3000

Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

// Device state
static bool mqtt_broker_found = false;
static bool device_approved = false;
static bool device_ready = false;
static bool previously_approved = false;

// A card was read and we are waiting for the server to say what it means.
static bool awaiting_card_resolve = false;
static unsigned long card_read_at = 0;

// Combo: hold vol up + vol down — restart on release after 2s, factory reset at 5s
static unsigned long both_vol_pressed_start = 0;
#define RESTART_HOLD_MS       2000
#define FACTORY_RESET_HOLD_MS 5000

// Holding a volume button ramps rather than requiring a press per step.
// Without this, crossing the range takes a press-release cycle per step, and
// the main loop only polls buttons every ~60ms because the NFC read blocks —
// so setting a level felt unresponsive however hard you pressed.
static unsigned long vol_hold_start = 0;
static unsigned long last_vol_repeat = 0;
#define VOL_REPEAT_AFTER_MS 400  // treat as a hold, not a click
#define VOL_REPEAT_EVERY_MS 120  // ~8 steps a second once ramping

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
// WiFi
// ─────────────────────────────────────────────────────────────────────────────

void onWifiConnected() {
    LOG_I(MOD_WIFI, "Connected");

    // Fetch any system cues we don't have. The audio task performs the writes
    // when nothing is playing.
    flash_request_system_sounds();

    if (!mqtt_broker_found) {
        mqtt_broker_found = mqtt_discover_broker();
    }
    if (mqtt_broker_found && !mqtt_is_connected()) {
        mqtt_connect();
    }
}

void onWifiDisconnected() {
    // wifi_manager handles reconnection
}

// ─────────────────────────────────────────────────────────────────────────────
// MQTT commands
// ─────────────────────────────────────────────────────────────────────────────

void onPlay(const char* url, int mediaId) {
    if (!url) return;
    LOG_I(MOD_AUDIO, "Play mediaId=%d", mediaId);
    // The answer we were waiting for, if we were.
    awaiting_card_resolve = false;
    audio_play_stream(url, mediaId);
}

void onPause()  { audio_pause(); }
void onResume() { audio_resume(); }
void onStop()   { audio_stop(); }

void onVolume(int level) {
    LOG_D(MOD_AUDIO, "Volume=%d", level);
    audio_set_volume(level);
}

void onOta(const char* url, const char* version, const char* sha256) {
    LOG_I(MOD_OTA, "Update available: v%s", version);

    if (audio_get_state() != AUDIO_IDLE) {
        LOG_I(MOD_OTA, "Stopping audio for update");
        audio_stop();

        unsigned long start = millis();
        while (audio_get_state() != AUDIO_IDLE &&
               millis() - start < OTA_AUDIO_STOP_TIMEOUT_MS) {
            delay(10);
        }

        if (audio_get_state() != AUDIO_IDLE) {
            // Proceed anyway: a wedged audio task is precisely when pushing
            // new firmware matters most.
            LOG_W(MOD_OTA, "Audio did not stop in %dms, updating anyway",
                  OTA_AUDIO_STOP_TIMEOUT_MS);
        }
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
        audio_play_system_sound(SOUND_STARTUP);
    }
}

void onErrorSound() {
    awaiting_card_resolve = false;
    audio_play_system_sound(SOUND_ERROR);
}

void onSoundMachineConfig(const char* url, const char* name, int volume) {
    if (url && url[0] != '\0') {
        LOG_I(MOD_AUDIO, "Sound machine configured: %s", name ? name : "(unnamed)");
    } else {
        LOG_I(MOD_AUDIO, "Sound machine configuration cleared");
    }
    // Stored locally so a long-press never has to ask the server, and keeps
    // working when the server is unreachable.
    flash_set_soundmachine_config(url, name, volume);
}

void onPlaybackStatus(const char* status, int mediaId) {
    LOG_D(MOD_AUDIO, "Status: %s, mediaId=%d", status, mediaId);
    // Safe from the audio task: this queues, and the publish happens on the
    // loop task. See the threading invariant in mqtt_client.
    mqtt_publish_playback_status(status, mediaId, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────────────────────

void onPlayClick(Button2 &btn) {
    // While the sound machine runs, the play button is its off switch. There
    // is no physical pause for the loop — only stop.
    if (audio_get_mode() == MODE_SOUNDMACHINE) {
        LOG_D(MOD_BTN, "Stopping sound machine");
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
    if (audio_get_mode() == MODE_SOUNDMACHINE) return;

    const char* path = flash_soundmachine_path();
    if (!path) {
        LOG_W(MOD_BTN, "No sound machine configured");
        audio_play_system_sound(SOUND_ERROR);
        return;
    }

    // Entirely local — no server round trip, so this works offline.
    LOG_D(MOD_BTN, "Starting sound machine");
    audio_play_soundmachine(path, flash_soundmachine_volume());
}

static void adjust_volume(int delta) {
    int vol = audio_get_volume() + delta;
    if (vol < 0) vol = 0;
    if (vol > audio_get_max_volume()) vol = audio_get_max_volume();
    if (vol != audio_get_volume()) audio_set_volume(vol);
}

void onVolUpClick(Button2 &btn) { adjust_volume(+1); }
void onVolDnClick(Button2 &btn) { adjust_volume(-1); }

/**
 * Skip is a request, not a local operation.
 *
 * The device holds no queue, so it reports the press and its position within
 * the current track; the server decides what to play and sends it back.
 */
static void publish_skip(const char* direction) {
    if (audio_get_mode() != MODE_NORMAL || audio_get_state() == AUDIO_IDLE) {
        return;  // nothing to skip within
    }
    if (!mqtt_is_connected()) {
        LOG_W(MOD_BTN, "Cannot skip while offline");
        return;
    }
    mqtt_publish_skip(direction, audio_get_elapsed_sec());
}

void onNextClick(Button2 &btn) {
    LOG_D(MOD_BTN, "Next");
    publish_skip("next");
}

void onPrevClick(Button2 &btn) {
    LOG_D(MOD_BTN, "Previous");
    publish_skip("previous");
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A uid has been captured. Nothing is known about it yet.
 *
 * The cue fires first and immediately: its job is to tell the user the card
 * was read and can be taken away, which must not wait on the network. Only
 * then do we ask the server what the card means.
 */
void onCardRead(const char* uid) {
    LOG_I(MOD_CARD, "Card read: %s", uid);

    audio_play_system_sound(SOUND_READ_CUE);

    if (!mqtt_is_connected()) {
        // No point waiting for an answer that cannot arrive.
        LOG_W(MOD_CARD, "Offline — cannot resolve card");
        audio_play_system_sound(SOUND_ERROR);
        return;
    }

    awaiting_card_resolve = true;
    card_read_at = millis();
    mqtt_publish_card_scanned(uid);
}

/**
 * Sample every button.
 *
 * Called more than once per pass: the NFC read blocks in between, and button
 * feel is governed by how often this runs rather than by anything in the
 * handlers.
 */
static void poll_buttons() {
    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup & loop
// ─────────────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== MUSICBOX ==========\n");

    logger_init();
    log_restart_reason();

    config_init();

    if (!config_is_provisioned()) {
        LOG_I(MOD_SYS, "Not provisioned - starting captive portal");
        provisioning_start();  // restarts on completion
        return;
    }

    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WDT_TIMEOUT * 1000,
        .idle_core_mask = 0,
        .trigger_panic = true,
    };
    esp_task_wdt_reconfigure(&wdt_config);
    esp_task_wdt_add(NULL);
    LOG_I(MOD_SYS, "Watchdog enabled (%ds)", WDT_TIMEOUT);

    previously_approved = config_get()->approved;
    if (previously_approved) {
        LOG_I(MOD_SYS, "Previously approved");
    }

    // Mounts the filesystem on the audio task, which then owns it.
    audio_init();

    btnPlay.begin(BTN_PLAY, INPUT_PULLUP, true);
    btnVolUp.begin(BTN_VOL_UP, INPUT_PULLUP, true);
    btnVolDn.begin(BTN_VOL_DN, INPUT_PULLUP, true);
    btnNext.begin(BTN_NEXT, INPUT_PULLUP, true);
    btnPrev.begin(BTN_PREV, INPUT_PULLUP, true);

    // Default debounce is 50ms, which on top of the polling interval is most
    // of what makes a press feel late.
    btnPlay.setDebounceTime(20);
    btnVolUp.setDebounceTime(20);
    btnVolDn.setDebounceTime(20);
    btnNext.setDebounceTime(20);
    btnPrev.setDebounceTime(20);

    btnPlay.setClickHandler(onPlayClick);
    btnPlay.setLongClickHandler(onPlayLongPress);
    btnPlay.setLongClickTime(1000);
    btnVolUp.setClickHandler(onVolUpClick);
    btnVolDn.setClickHandler(onVolDnClick);
    btnNext.setClickHandler(onNextClick);
    btnPrev.setClickHandler(onPrevClick);

    nfc_init();
    nfc_on_card_scanned(onCardRead);

    // Reads still register offline — the cue fires and the sound machine
    // works — even though resolving a card needs the server.
    if (previously_approved) {
        nfc_set_enabled(true);
    }

    audio_on_playback_status(onPlaybackStatus);
    ota_init();

    mqtt_init();
    mqtt_on_play(onPlay);
    mqtt_on_pause(onPause);
    mqtt_on_resume(onResume);
    mqtt_on_stop(onStop);
    mqtt_on_volume(onVolume);
    mqtt_on_ota(onOta);
    mqtt_on_approved(onApproved);
    mqtt_on_error_sound(onErrorSound);
    mqtt_on_soundmachine_config(onSoundMachineConfig);

    wifi_init(onWifiConnected, onWifiDisconnected);

    LOG_I(MOD_SYS, "Setup complete");
}

void loop() {
    esp_task_wdt_reset();

    wifi_loop();
    mqtt_loop();

    poll_buttons();

    // Combo: vol up + vol down held
    //   Release after 2s → restart
    //   Hold 5s → factory reset (clears NVS, back to captive portal)
    if (btnVolUp.isPressed() && btnVolDn.isPressed()) {
        if (both_vol_pressed_start == 0) {
            both_vol_pressed_start = millis();
        } else if (millis() - both_vol_pressed_start >= FACTORY_RESET_HOLD_MS) {
            LOG_I(MOD_SYS, "Factory reset (vol up+down held 5s)");
            config_factory_reset();  // clears NVS and restarts
        }
    } else {
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

    // Ramp while exactly one volume button is held. Both together is the
    // restart/factory-reset combo, so leave that alone.
    {
        bool volUp = btnVolUp.isPressed();
        bool volDn = btnVolDn.isPressed();

        if (volUp != volDn) {
            unsigned long now = millis();
            if (vol_hold_start == 0) {
                vol_hold_start = now;
                last_vol_repeat = now;
            } else if (now - vol_hold_start > VOL_REPEAT_AFTER_MS &&
                       now - last_vol_repeat >= VOL_REPEAT_EVERY_MS) {
                last_vol_repeat = now;
                adjust_volume(volUp ? +1 : -1);
            }
        } else {
            vol_hold_start = 0;
        }
    }

    nfc_loop();
    poll_buttons();  // again: the read above blocked for a while

    // A card was read but no answer arrived. Say so, rather than leaving the
    // user with a cue and then silence. Informational only: a play that turns
    // up late is still honoured.
    if (awaiting_card_resolve && millis() - card_read_at > CARD_RESOLVE_TIMEOUT_MS) {
        awaiting_card_resolve = false;
        LOG_W(MOD_CARD, "No response for scanned card");
        audio_play_system_sound(SOUND_ERROR);
    }

    // Send buffered logs to server.
    //
    // Chunked well below the MQTT client's buffer: the JSON envelope and any
    // escaping are pure overhead on top of the text, and an oversized publish
    // is dropped silently. Anything left over goes out on the next pass rather
    // than being lost.
    static unsigned long last_log_send = 0;
    if (mqtt_is_connected() && logger_has_pending() && millis() - last_log_send > 2000) {
        last_log_send = millis();
        char logBuf[768];
        int len = logger_peek_buffer(logBuf, sizeof(logBuf));
        // Only discard what the server actually accepted. Consuming on the way
        // in meant a rejected publish took the lines with it — and a boot's
        // worth of logs is exactly the batch most likely to be rejected.
        if (len > 0 && mqtt_publish_logs(logBuf)) {
            logger_consume(len);
        }
    }

    // Periodic status
    static unsigned long last_status = 0;
    if (millis() - last_status > 30000) {
        last_status = millis();

        const char* mode = "online";
        if (!wifi_is_connected() || !mqtt_is_connected()) {
            mode = previously_approved ? "offline" : "disconnected";
        }

        LOG_I(MOD_SYS, "%s | wifi=%d mqtt=%d nfc=%d fs=%d audio=%d/%d up=%lus",
            mode,
            wifi_is_connected() ? 1 : 0,
            mqtt_is_connected() ? 1 : 0,
            nfc_is_ready() ? 1 : 0,
            flash_available() ? 1 : 0,
            (int)audio_get_state(),
            (int)audio_get_mode(),
            millis() / 1000);
    }

    // Kept short: this adds directly to button-polling latency, on top of the
    // NFC read that already dominates it.
    delay(2);
}
