#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"

// WiFi state
bool wifi_connected = false;
unsigned long last_reconnect_attempt = 0;
int reconnect_delay = 1000;  // Start at 1 second, backoff to max 30 seconds
const int max_reconnect_delay = 30000;

void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            wifi_connected = true;
            reconnect_delay = 1000;  // Reset backoff on successful connection
            Serial.printf("[WiFi] Connected (IP: %s)\n", WiFi.localIP().toString().c_str());
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
    if (now - last_reconnect_attempt < reconnect_delay) return;

    last_reconnect_attempt = now;
    Serial.printf("[WiFi] Reconnecting (backoff: %ds)...\n", reconnect_delay / 1000);

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    // Increase backoff for next attempt (exponential with max)
    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay);
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== WIFI RECONNECTION TEST ==========\n");

    // Register WiFi event handler
    WiFi.onEvent(onWiFiEvent);

    // Initial connection
    Serial.println("[WiFi] Connecting...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);

    // Wait for initial connection (up to 10 seconds)
    for (int i = 0; i < 20 && !wifi_connected; i++) {
        delay(500);
    }

    if (!wifi_connected) {
        Serial.println("[WiFi] Initial connection failed, will retry in loop");
    }

    Serial.println("\n[Test] Turn off router to test disconnection detection");
    Serial.println("[Test] Turn on router to test automatic reconnection\n");
}

void loop() {
    // Try to reconnect if disconnected
    tryReconnect();

    // Simulate other work continuing during disconnection
    static unsigned long last_status = 0;
    if (millis() - last_status > 5000) {
        last_status = millis();
        Serial.printf("[Status] WiFi: %s | Uptime: %lus\n",
            wifi_connected ? "connected" : "disconnected",
            millis() / 1000);
    }

    delay(100);
}
