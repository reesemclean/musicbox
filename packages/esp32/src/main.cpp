#include <Arduino.h>
#include "wifi_manager.h"
#include "mqtt_client.h"
#include "nfc_reader.h"

// Device state
static bool mqtt_broker_found = false;
static bool device_approved = false;

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
    // TODO: Start audio playback (Phase 11)
}

void onPause() {
    Serial.println("[Pause]");
    // TODO: Pause audio
}

void onResume() {
    Serial.println("[Resume]");
    // TODO: Resume audio
}

void onStop() {
    Serial.println("[Stop]");
    // TODO: Stop audio
}

void onVolume(int level) {
    Serial.printf("[Volume] Level: %d\n", level);
    // TODO: Set volume
}

void onOta(const char* url, const char* version) {
    Serial.printf("[OTA] URL: %s, Version: %s\n", url, version);
    // TODO: Start OTA update (Phase 16)
}

void onApproved() {
    Serial.println("[Approved] Device approved by server");
    device_approved = true;
    nfc_set_enabled(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// NFC callback
// ─────────────────────────────────────────────────────────────────────────────

void onCardScanned(const char* uid) {
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

    // Initialize NFC reader
    nfc_init();
    nfc_on_card_scanned(onCardScanned);

    // Initialize MQTT (sets up callbacks and topics)
    mqtt_init();
    mqtt_on_play(onPlay);
    mqtt_on_pause(onPause);
    mqtt_on_resume(onResume);
    mqtt_on_stop(onStop);
    mqtt_on_volume(onVolume);
    mqtt_on_ota(onOta);
    mqtt_on_approved(onApproved);

    // Initialize WiFi (will trigger onWifiConnected when ready)
    wifi_init(onWifiConnected, onWifiDisconnected);
}

void loop() {
    // Handle WiFi reconnection
    wifi_loop();

    // Handle MQTT
    mqtt_loop();

    // Poll NFC reader
    nfc_loop();

    // Periodic status update
    static unsigned long last_status = 0;
    if (millis() - last_status > 10000) {
        last_status = millis();
        Serial.printf("[Status] WiFi: %s | MQTT: %s | Approved: %s | NFC: %s | Uptime: %lus\n",
            wifi_is_connected() ? "connected" : "disconnected",
            mqtt_is_connected() ? "connected" : "disconnected",
            device_approved ? "yes" : "no",
            nfc_is_ready() ? "ready" : "error",
            millis() / 1000);
    }

    delay(10);
}
