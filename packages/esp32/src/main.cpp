#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"
#include "mqtt_client.h"

// WiFi state
bool wifi_connected = false;
unsigned long last_reconnect_attempt = 0;
int reconnect_delay = 1000;
const int max_reconnect_delay = 30000;

// MQTT state
bool mqtt_broker_found = false;
bool device_approved = false;

void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            wifi_connected = true;
            reconnect_delay = 1000;
            Serial.printf("[WiFi] Connected (IP: %s)\n", WiFi.localIP().toString().c_str());

            // Try to discover MQTT broker
            if (!mqtt_broker_found) {
                mqtt_broker_found = mqtt_discover_broker();
                if (mqtt_broker_found) {
                    mqtt_connect();
                }
            } else if (!mqtt_is_connected()) {
                mqtt_connect();
            }
            break;

        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            wifi_connected = false;
            Serial.println("[WiFi] Disconnected");
            break;

        default:
            break;
    }
}

void tryReconnect() {
    if (wifi_connected) return;

    unsigned long now = millis();
    if (now - last_reconnect_attempt < (unsigned long)reconnect_delay) return;

    last_reconnect_attempt = now;
    Serial.printf("[WiFi] Reconnecting (backoff: %ds)...\n", reconnect_delay / 1000);

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay);
}

// Command callbacks
void onPlay(const char* url, int mediaId) {
    Serial.printf("[Play] URL: %s, mediaId: %d\n", url, mediaId);
    // TODO: Start audio playback
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
    // TODO: Start OTA update
}

void onApproved() {
    Serial.println("[Approved] Device approved by server");
    device_approved = true;
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== MUSICBOX DEVICE ==========\n");

    // Initialize MQTT
    mqtt_init();

    // Register command callbacks
    mqtt_on_play(onPlay);
    mqtt_on_pause(onPause);
    mqtt_on_resume(onResume);
    mqtt_on_stop(onStop);
    mqtt_on_volume(onVolume);
    mqtt_on_ota(onOta);
    mqtt_on_approved(onApproved);

    // Register WiFi event handler
    WiFi.onEvent(onWiFiEvent);

    // Initial WiFi connection
    Serial.println("[WiFi] Connecting...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    // Wait for initial connection
    for (int i = 0; i < 20 && !wifi_connected; i++) {
        delay(500);
    }

    if (!wifi_connected) {
        Serial.println("[WiFi] Initial connection failed, will retry in loop");
    }
}

void loop() {
    // Handle WiFi reconnection
    tryReconnect();

    // Handle MQTT
    mqtt_loop();

    // Status update
    static unsigned long last_status = 0;
    if (millis() - last_status > 5000) {
        last_status = millis();
        Serial.printf("[Status] WiFi: %s | MQTT: %s | Approved: %s | Uptime: %lus\n",
            wifi_connected ? "connected" : "disconnected",
            mqtt_is_connected() ? "connected" : "disconnected",
            device_approved ? "yes" : "no",
            millis() / 1000);
    }

    delay(10);
}
