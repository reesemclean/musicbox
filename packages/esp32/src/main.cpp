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

// How long a card read already waiting on the reader can take to finish once
// scanning is switched off: two NFC read timeouts, plus margin.
#define OTA_NFC_SETTLE_MS 250

// Once the input task starts, only it touches these.
Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

// How often the input task samples the buttons. Well inside the debounce time,
// so a press is acted on within a few ms of being confirmed.
#define BUTTON_POLL_MS 5

// A firmware update is under way. Set before audio is stopped for it, so a
// long-press in that window can't start the sound machine back up.
static volatile bool update_underway = false;

// Skips pressed on the input task, waiting for the loop task to publish them —
// it is the only task allowed to call into MQTT.
typedef struct {
    const char* direction;  // a string literal, so safe to pass between tasks
    uint32_t elapsed_sec;   // how far into the track, at the press
    unsigned long pressed_at;
} SkipRequest;

#define SKIP_QUEUE_SIZE 4

// A skip still waiting this long after the press is dropped rather than sent:
// the loop task was stalled reconnecting, and by now the user has given up or
// pressed again. Normally one is published within a few ms.
#define SKIP_STALE_MS 1000
static QueueHandle_t skipQueue = NULL;

// Device state
static bool mqtt_broker_found = false;
static bool device_approved = false;
static bool device_ready = false;
static bool previously_approved = false;

// A card was read and we are waiting for the server to say what it means.
static bool awaiting_card_resolve = false;
static unsigned long card_read_at = 0;

// Button state below here belongs to the input task.

// Combo: hold vol up + vol down — restart on release after 2s, factory reset at 5s
static unsigned long both_vol_pressed_start = 0;
#define RESTART_HOLD_MS       2000
#define FACTORY_RESET_HOLD_MS 5000

// Holding a volume button ramps rather than requiring a press per step.
// Without this, crossing the range takes a press-release cycle per step, which
// made setting a level feel unresponsive however hard you pressed.
static unsigned long vol_hold_start = 0;
static unsigned long last_vol_repeat = 0;
#define VOL_REPEAT_AFTER_MS 400  // treat as a hold, not a click
#define VOL_REPEAT_EVERY_MS 120  // ~8 steps a second once ramping

// Hold play this long to start the sound machine.
#define PLAY_HOLD_MS 1000

// Set when a press on play turned the sound machine off, so the long-press the
// same hold goes on to reach doesn't turn it straight back on.
static bool play_press_stopped_soundmachine = false;

// Set when a press on play found a paused track. Resuming is the one thing
// play does that makes sound, and the press may be the start of a hold for the
// sound machine — so the resume waits for the release, and is dropped if the
// hold got that far.
static bool play_resume_on_release = false;

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

    // Nothing may start audio again while it drains below. Buttons stay live
    // on the input task while this blocks the loop — only the long-press
    // could start audio, and it checks this — and card reads cue from the
    // scan task, so they are switched off first rather than after the wait.
    update_underway = true;
    nfc_set_enabled(false);

    // A read already waiting on the reader finishes on the scan task whatever
    // the flag says. The scan task's recheck and onCardRead both drop it, but
    // one that passed them just before they flipped could still queue a cue.
    // So let it finish, then send the stop whatever the current state: it
    // lands behind anything queued, rather than being skipped because the cue
    // hadn't started yet. The loop is blocked for the update anyway.
    delay(OTA_NFC_SETTLE_MS);
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

    // Success restarts into the new firmware, so returning at all means the
    // update failed and the old firmware is still running. Give back what the
    // update took away — card reading would otherwise stay off until reboot.
    if (!ota_start_update(url, version, sha256)) {
        update_underway = false;
        if (config_get()->approved) nfc_set_enabled(true);
    }
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
// Buttons — everything here runs on the input task.
//
// Every button acts on the press, not the click. Button2 reports a click only
// once its double-click window has passed, which put 300ms between a press
// and its effect — and it counts taps closer together than that as a double
// or triple click, which nothing here handles, so rapid taps did nothing.
// The one exception is play resuming a paused track, which waits for the
// release (see onPlayPressed).
// ─────────────────────────────────────────────────────────────────────────────

void onPlayPressed(Button2 &btn) {
    // Read before the toggle is queued: once it runs, the sound machine is no
    // longer the mode, and this same hold reaching the long-press would start
    // it again.
    play_press_stopped_soundmachine = audio_get_mode() == MODE_SOUNDMACHINE;

    // A paused track resumes on the release instead (see onPlayReleased).
    // Acting now would play a second of it before a hold for the sound
    // machine took over.
    play_resume_on_release =
        audio_get_mode() == MODE_NORMAL && audio_get_state() == AUDIO_PAUSED;
    if (play_resume_on_release) return;

    // Everything else a press does is silent — stop the sound machine,
    // pause, or nothing during a cue — so it happens now. The audio task
    // decides which, since it owns the state the choice depends on.
    audio_toggle();
}

void onPlayReleased(Button2 &btn) {
    if (!play_resume_on_release) return;
    play_resume_on_release = false;

    // Audio has to stay stopped for an update (§7).
    if (update_underway) return;

    // A resume rather than a toggle: if the state has moved on since the
    // press — a remote resume or stop — this does nothing instead of pausing.
    audio_resume();
}

void onPlayLongPress(Button2 &btn) {
    // The hold reached the sound machine, so the resume the press held back
    // is no longer wanted — whatever happens below.
    play_resume_on_release = false;

    if (play_press_stopped_soundmachine) return;
    if (audio_get_mode() == MODE_SOUNDMACHINE) return;
    // Audio was stopped for the update and has to stay that way (§7).
    if (update_underway) return;

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

// The step lands at once; holding on past VOL_REPEAT_AFTER_MS ramps.
void onVolUpPressed(Button2 &btn) { audio_step_volume(+1); }
void onVolDnPressed(Button2 &btn) { audio_step_volume(-1); }

/**
 * Skip is a request, not a local operation.
 *
 * The device holds no queue, so it reports the press and its position within
 * the current track; the server decides what to play and sends it back. The
 * report itself goes out from the loop task — see publish_pending_skips().
 */
static void request_skip(const char* direction) {
    if (skipQueue == NULL) return;
    if (audio_get_mode() != MODE_NORMAL || audio_get_state() == AUDIO_IDLE) {
        return;  // nothing to skip within
    }

    // Elapsed is taken now, at the press, not whenever the loop task gets to
    // publishing it.
    SkipRequest skip = { direction, audio_get_elapsed_sec(), millis() };
    if (xQueueSend(skipQueue, &skip, 0) != pdTRUE) {
        LOG_W(MOD_BTN, "Skip queue full, dropping press");
    }
}

void onNextPressed(Button2 &btn) {
    LOG_D(MOD_BTN, "Next");
    request_skip("next");
}

void onPrevPressed(Button2 &btn) {
    LOG_D(MOD_BTN, "Previous");
    request_skip("previous");
}

/** Sample every button. */
static void poll_buttons() {
    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();
}

/**
 * Vol up + vol down held together.
 *
 * Release after RESTART_HOLD_MS restarts; holding to FACTORY_RESET_HOLD_MS
 * factory-resets (clears NVS, back to the captive portal) without waiting for
 * the release.
 */
static void check_volume_combo() {
    if (btnVolUp.isPressed() && btnVolDn.isPressed()) {
        if (both_vol_pressed_start == 0) {
            both_vol_pressed_start = millis();
        } else if (millis() - both_vol_pressed_start >= FACTORY_RESET_HOLD_MS) {
            LOG_I(MOD_SYS, "Factory reset (vol up+down held 5s)");
            config_factory_reset();  // clears NVS and restarts
        }
        return;
    }

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

/**
 * Step the volume while exactly one volume button is held. Both together is
 * the restart/factory-reset combo, so that is left alone.
 */
static void ramp_volume() {
    bool volUp = btnVolUp.isPressed();
    bool volDn = btnVolDn.isPressed();

    if (volUp == volDn) {
        vol_hold_start = 0;
        return;
    }

    unsigned long now = millis();
    if (vol_hold_start == 0) {
        vol_hold_start = now;
        last_vol_repeat = now;
    } else if (now - vol_hold_start > VOL_REPEAT_AFTER_MS &&
               now - last_vol_repeat >= VOL_REPEAT_EVERY_MS) {
        last_vol_repeat = now;
        audio_step_volume(volUp ? +1 : -1);
    }
}

/**
 * Buttons, on a task of their own.
 *
 * The loop task can stall for seconds — an MQTT reconnect to a server that
 * isn't answering blocks it — and buttons sampled there froze with it. Nothing
 * a press does needs the loop task: audio commands can be queued from any
 * task, and a skip, the one press that needs the network, is handed back to
 * the loop to publish.
 */
static void inputTask(void* parameter) {
    for (;;) {
        poll_buttons();
        check_volume_combo();
        ramp_volume();
        vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_MS));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A uid has been captured. Nothing is known about it yet. Scan task.
 *
 * The cue's job is to tell the user the card was read and can be taken away,
 * so it goes out from here, the instant of the read. Handing it to the loop
 * task first would make it wait behind whatever the loop is blocked on.
 */
static void onCardRead(const char* uid) {
    // Audio has to stay stopped for an update (§7). The scan task rechecks
    // whether scanning is on, but a read can pass that just as it is turned
    // off.
    if (update_underway) return;
    audio_play_system_sound(SOUND_READ_CUE);
}

/**
 * The same read, now on the loop task: ask the server what the card means.
 */
void onCardScanned(const char* uid) {
    LOG_I(MOD_CARD, "Card read: %s", uid);

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

// ─────────────────────────────────────────────────────────────────────────────
// Skips — pressed on the input task, published here on the loop task.
// ─────────────────────────────────────────────────────────────────────────────

static void publish_pending_skips() {
    if (skipQueue == NULL) return;

    SkipRequest skip;
    while (xQueueReceive(skipQueue, &skip, 0) == pdTRUE) {
        if (!mqtt_is_connected()) {
            LOG_W(MOD_BTN, "Cannot skip while offline");
            continue;
        }
        if (millis() - skip.pressed_at > SKIP_STALE_MS) {
            LOG_W(MOD_BTN, "Dropping skip pressed %lums ago",
                  millis() - skip.pressed_at);
            continue;
        }
        mqtt_publish_skip(skip.direction, skip.elapsed_sec);
    }
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

    Button2* buttons[] = { &btnPlay, &btnVolUp, &btnVolDn, &btnNext, &btnPrev };
    for (size_t i = 0; i < sizeof(buttons) / sizeof(buttons[0]); i++) {
        // A press fires once it has been held this long, so this is now most
        // of the delay between pressing and hearing. Still well past contact
        // bounce; Button2's default is 50.
        buttons[i]->setDebounceTime(20);
        // No multi-click gestures are used, so report each press on its own.
        // This also matters for the long-press: Button2 only looks for one on
        // the first click of a sequence, so a tap followed quickly by a hold
        // would otherwise never start the sound machine.
        buttons[i]->setDoubleClickTime(0);
    }

    btnPlay.setPressedHandler(onPlayPressed);
    btnPlay.setReleasedHandler(onPlayReleased);
    // "Detected" fires when the hold reaches the threshold, while the button
    // is still down. The plain long-click handler waits for the release.
    btnPlay.setLongClickDetectedHandler(onPlayLongPress);
    btnPlay.setLongClickTime(PLAY_HOLD_MS);
    btnVolUp.setPressedHandler(onVolUpPressed);
    btnVolDn.setPressedHandler(onVolDnPressed);
    btnNext.setPressedHandler(onNextPressed);
    btnPrev.setPressedHandler(onPrevPressed);

    skipQueue = xQueueCreate(SKIP_QUEUE_SIZE, sizeof(SkipRequest));
    if (skipQueue == NULL) {
        LOG_E(MOD_BTN, "Failed to create skip queue");
    }

    // Started here, ahead of the WiFi wait below, so the buttons work from
    // the first seconds after power-on. Core 1 alongside the loop and scan
    // tasks, away from audio and WiFi on core 0, and one priority above both
    // so a press is handled even while either is busy. It sleeps between
    // samples, so it costs them next to nothing.
    xTaskCreatePinnedToCore(inputTask, "InputTask", 4096, NULL, 2, NULL, 1);

    nfc_init();
    nfc_on_card_read(onCardRead);
    nfc_on_card_scanned(onCardScanned);

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

    // Recorded alongside the audio task's own core so the pairing is visible
    // rather than assumed. Whether these two share a core decides whether work
    // added here can starve playback directly or only through contention.
    LOG_I(MOD_SYS, "Setup complete (loop task on core %d)", xPortGetCoreID());
}

void loop() {
    esp_task_wdt_reset();

    wifi_loop();
    mqtt_loop();

    // Buttons are sampled on the input task; only skips come through here.
    publish_pending_skips();

    // Hands over reads the scan task has already completed — does not block.
    nfc_loop();

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

    // Kept short so a card read or a skip reaches MQTT promptly. Buttons no
    // longer depend on it — they have their own task.
    delay(2);
}
