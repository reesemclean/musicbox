#include "device_config.h"
#include <Preferences.h>
#include <Arduino.h>

static DeviceConfig cfg;
static Preferences prefs;

static void update_provisioned() {
    cfg.provisioned = (cfg.wifi_ssid[0] != '\0' && cfg.api_base_url[0] != '\0');
}

void config_init() {
    memset(&cfg, 0, sizeof(cfg));
    cfg.mqtt_port = 1883;

    prefs.begin("musicbox", true);  // read-only

    String ssid = prefs.getString("wifi_ssid", "");
    String pass = prefs.getString("wifi_pass", "");
    String url  = prefs.getString("api_url", "");
    String stream_url = prefs.getString("stream_url", "");
    String host = prefs.getString("mqtt_host", "");
    cfg.mqtt_port = prefs.getUShort("mqtt_port", 1883);
    cfg.approved  = prefs.getBool("approved", false);

    prefs.end();

    strncpy(cfg.wifi_ssid, ssid.c_str(), sizeof(cfg.wifi_ssid) - 1);
    strncpy(cfg.wifi_pass, pass.c_str(), sizeof(cfg.wifi_pass) - 1);
    strncpy(cfg.api_base_url, url.c_str(), sizeof(cfg.api_base_url) - 1);
    strncpy(cfg.stream_base_url, stream_url.c_str(), sizeof(cfg.stream_base_url) - 1);
    strncpy(cfg.mqtt_host, host.c_str(), sizeof(cfg.mqtt_host) - 1);

    update_provisioned();

    Serial.printf("[Config] Loaded: ssid=%s url=%s mqtt=%s:%d approved=%d provisioned=%d\n",
        cfg.wifi_ssid, cfg.api_base_url, cfg.mqtt_host, cfg.mqtt_port,
        cfg.approved, cfg.provisioned);
}

const DeviceConfig* config_get() {
    return &cfg;
}

void config_set_wifi(const char* ssid, const char* pass) {
    strncpy(cfg.wifi_ssid, ssid, sizeof(cfg.wifi_ssid) - 1);
    cfg.wifi_ssid[sizeof(cfg.wifi_ssid) - 1] = '\0';
    strncpy(cfg.wifi_pass, pass, sizeof(cfg.wifi_pass) - 1);
    cfg.wifi_pass[sizeof(cfg.wifi_pass) - 1] = '\0';

    prefs.begin("musicbox", false);
    prefs.putString("wifi_ssid", cfg.wifi_ssid);
    prefs.putString("wifi_pass", cfg.wifi_pass);
    prefs.end();

    update_provisioned();
    Serial.printf("[Config] WiFi saved: %s\n", cfg.wifi_ssid);
}

void config_set_api_url(const char* url) {
    strncpy(cfg.api_base_url, url, sizeof(cfg.api_base_url) - 1);
    cfg.api_base_url[sizeof(cfg.api_base_url) - 1] = '\0';

    // Strip trailing slash if present
    size_t len = strlen(cfg.api_base_url);
    if (len > 0 && cfg.api_base_url[len - 1] == '/') {
        cfg.api_base_url[len - 1] = '\0';
    }

    prefs.begin("musicbox", false);
    prefs.putString("api_url", cfg.api_base_url);
    prefs.end();

    update_provisioned();
    Serial.printf("[Config] API URL saved: %s\n", cfg.api_base_url);
}

void config_set_mqtt(const char* host, uint16_t port) {
    strncpy(cfg.mqtt_host, host, sizeof(cfg.mqtt_host) - 1);
    cfg.mqtt_host[sizeof(cfg.mqtt_host) - 1] = '\0';
    cfg.mqtt_port = port;

    prefs.begin("musicbox", false);
    prefs.putString("mqtt_host", cfg.mqtt_host);
    prefs.putUShort("mqtt_port", cfg.mqtt_port);
    prefs.end();

    Serial.printf("[Config] MQTT saved: %s:%d\n", cfg.mqtt_host, cfg.mqtt_port);
}

void config_set_stream_url(const char* url) {
    strncpy(cfg.stream_base_url, url, sizeof(cfg.stream_base_url) - 1);
    cfg.stream_base_url[sizeof(cfg.stream_base_url) - 1] = '\0';

    // Strip trailing slash if present
    size_t len = strlen(cfg.stream_base_url);
    if (len > 0 && cfg.stream_base_url[len - 1] == '/') {
        cfg.stream_base_url[len - 1] = '\0';
    }

    prefs.begin("musicbox", false);
    prefs.putString("stream_url", cfg.stream_base_url);
    prefs.end();

    Serial.printf("[Config] Stream URL saved: %s\n", cfg.stream_base_url);
}

void config_set_approved(bool approved) {
    cfg.approved = approved;

    prefs.begin("musicbox", false);
    prefs.putBool("approved", cfg.approved);
    prefs.end();

    Serial.printf("[Config] Approved: %d\n", cfg.approved);
}

bool config_is_provisioned() {
    return cfg.provisioned;
}

const char* config_api_base_url() {
    return cfg.api_base_url;
}

const char* config_stream_base_url() {
    if (cfg.stream_base_url[0] != '\0') {
        return cfg.stream_base_url;
    }
    return cfg.api_base_url;
}

void config_factory_reset() {
    Serial.println("[Config] Factory reset - clearing NVS...");

    prefs.begin("musicbox", false);
    prefs.clear();
    prefs.end();

    Serial.println("[Config] NVS cleared, restarting...");
    delay(500);
    ESP.restart();
}
