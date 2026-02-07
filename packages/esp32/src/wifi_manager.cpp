#include "wifi_manager.h"
#include "device_config.h"
#include <WiFi.h>

// State
static bool connected = false;
static volatile bool just_connected = false;   // set in event callback, consumed in loop
static volatile bool just_disconnected = false;
static unsigned long last_reconnect_attempt = 0;
static int reconnect_delay = 1000;
static const int max_reconnect_delay = 30000;
static String ip_address;

// Callbacks
static WifiConnectedCallback on_connected_cb = nullptr;
static WifiDisconnectedCallback on_disconnected_cb = nullptr;

static void onWiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            connected = true;
            just_connected = true;
            reconnect_delay = 1000;
            ip_address = WiFi.localIP().toString();
            Serial.printf("[WiFi] Connected (IP: %s)\n", ip_address.c_str());
            // Don't call callbacks here — event task has a small stack.
            // Callbacks are dispatched from wifi_loop() on the main task.
            break;

        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            connected = false;
            just_disconnected = true;
            ip_address = "";
            Serial.println("[WiFi] Disconnected");
            break;

        default:
            break;
    }
}

void wifi_init(WifiConnectedCallback on_connected, WifiDisconnectedCallback on_disconnected) {
    on_connected_cb = on_connected;
    on_disconnected_cb = on_disconnected;

    // Register event handler
    WiFi.onEvent(onWiFiEvent);

    // Start connection (non-blocking)
    // Device starts immediately, WiFi connects in background
    Serial.println("[WiFi] Connecting (non-blocking)...");
    WiFi.mode(WIFI_STA);
    const DeviceConfig* cfg = config_get();
    WiFi.begin(cfg->wifi_ssid, cfg->wifi_pass);

    // Brief wait to give WiFi a chance to connect quickly
    // But don't block for long - device should be usable offline
    for (int i = 0; i < 6 && !connected; i++) {
        delay(500);
    }

    if (!connected) {
        Serial.println("[WiFi] Still connecting, device continuing in offline mode");
    }
}

void wifi_loop() {
    // Dispatch deferred callbacks on the main task (safe stack size)
    if (just_connected) {
        just_connected = false;
        if (on_connected_cb) {
            on_connected_cb();
        }
    }
    if (just_disconnected) {
        just_disconnected = false;
        if (on_disconnected_cb) {
            on_disconnected_cb();
        }
    }

    if (connected) return;

    unsigned long now = millis();
    if (now - last_reconnect_attempt < (unsigned long)reconnect_delay) return;

    last_reconnect_attempt = now;
    Serial.printf("[WiFi] Reconnecting (backoff: %ds)...\n", reconnect_delay / 1000);

    const DeviceConfig* cfg = config_get();
    WiFi.disconnect();
    WiFi.begin(cfg->wifi_ssid, cfg->wifi_pass);

    reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay);
}

bool wifi_is_connected() {
    return connected;
}

const char* wifi_get_ip() {
    return ip_address.c_str();
}
