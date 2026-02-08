#ifndef DEVICE_CONFIG_H
#define DEVICE_CONFIG_H

#include <stdint.h>
#include <stdbool.h>

struct DeviceConfig {
    char wifi_ssid[33];
    char wifi_pass[64];
    char api_base_url[128];
    char stream_base_url[128];
    char mqtt_host[128];
    uint16_t mqtt_port;
    bool approved;
    bool provisioned;  // true if wifi_ssid + api_base_url are non-empty
};

// Load config from NVS (call once at boot)
void config_init();

// Get current config (read-only)
const DeviceConfig* config_get();

// Setters (write to NVS immediately)
void config_set_wifi(const char* ssid, const char* pass);
void config_set_api_url(const char* url);
void config_set_mqtt(const char* host, uint16_t port);
void config_set_approved(bool approved);
void config_set_stream_url(const char* url);

// Convenience
bool config_is_provisioned();
const char* config_api_base_url();
const char* config_stream_base_url();

// Clear all NVS config and restart
void config_factory_reset();

#endif
