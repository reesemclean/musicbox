#include "provisioning.h"
#include "device_config.h"
#include <WiFiManager.h>

// Portal timeout in seconds (5 minutes)
#define PORTAL_TIMEOUT 300

bool provisioning_start() {
    Serial.println("[Provisioning] Starting captive portal...");

    WiFiManager wm;

    // Reset any previously stored WiFi creds in WiFiManager
    // (we manage persistence ourselves via NVS)
    wm.resetSettings();

    // Custom parameter: server URL
    WiFiManagerParameter serverUrlParam("server_url", "MusicBox Server URL", "http://", 128);
    wm.addParameter(&serverUrlParam);

    // Portal settings
    wm.setConfigPortalTimeout(PORTAL_TIMEOUT);
    wm.setConnectTimeout(30);

    // Start AP and captive portal (blocks until saved or timeout)
    bool connected = wm.startConfigPortal("MusicBox-Setup");

    if (connected) {
        // Save WiFi credentials
        // Keep String objects alive so c_str() pointers remain valid
        String ssid = wm.getWiFiSSID();
        String pass = wm.getWiFiPass();
        config_set_wifi(ssid.c_str(), pass.c_str());

        // Save server URL
        const char* serverUrl = serverUrlParam.getValue();
        if (serverUrl && strlen(serverUrl) > 0 && strcmp(serverUrl, "http://") != 0) {
            config_set_api_url(serverUrl);
        }

        Serial.println("[Provisioning] Credentials saved, restarting...");
        delay(500);
        ESP.restart();
        return true;  // Won't reach here
    }

    // Timeout - restart and try again
    Serial.println("[Provisioning] Timeout, restarting...");
    delay(500);
    ESP.restart();
    return false;  // Won't reach here
}
