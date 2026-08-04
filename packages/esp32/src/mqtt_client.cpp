#include "mqtt_client.h"
#include "device_config.h"
#include "audio_player.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_mac.h>

// ─────────────────────────────────────────────────────────────────────────────
// THREADING INVARIANT
//
// PubSubClient and its WiFiClient are NOT thread-safe. Every call into
// mqttClient (publish, subscribe, loop) must happen on the task that runs
// mqtt_loop() — i.e. the Arduino loop task on Core 1.
//
// Anything originating on the audio task (Core 0) must hand off via a queue
// drained in mqtt_loop(), the same way wifi_manager defers its event
// callbacks. mqtt_publish_playback_status() is the one such path today; if
// you add another publisher reachable from Core 0, route it through a queue
// too rather than calling mqttClient directly.
// ─────────────────────────────────────────────────────────────────────────────

// WiFi client for MQTT
static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);

// Playback status published from the audio task (Core 0) — queued here and
// actually sent from mqtt_loop() on Core 1.
struct PlaybackStatusMsg {
    char status[16];
    int mediaId;
    int position;
};

#define STATUS_QUEUE_SIZE 8
static QueueHandle_t statusQueue = NULL;

// Broker info
static String brokerHost = "";
static uint16_t brokerPort = 1883;
static bool brokerDiscovered = false;

// Device info
static String deviceMac;
static String macForTopic;
static String topicEvents;
static String topicCommands;
static String topicStatus;

// Reconnection
static unsigned long lastReconnectAttempt = 0;
static const unsigned long reconnectInterval = 5000;

// Callbacks
static PlayCallback onPlayCb = nullptr;
static PauseCallback onPauseCb = nullptr;
static ResumeCallback onResumeCb = nullptr;
static StopCallback onStopCb = nullptr;
static VolumeCallback onVolumeCb = nullptr;
static OtaCallback onOtaCb = nullptr;
static ApprovedCallback onApprovedCb = nullptr;
static ErrorSoundCallback onErrorSoundCb = nullptr;
static SoundMachineConfigCallback onSoundMachineConfigCb = nullptr;

// Forward declarations
static void onMqttMessage(char* topic, byte* payload, unsigned int length);
static void publishRegistration();

void mqtt_init() {
    // Get MAC address from hardware eFuse (works before WiFi init)
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    deviceMac = String(macStr);

    // MAC without colons for topic
    char macTopicStr[13];
    snprintf(macTopicStr, sizeof(macTopicStr), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    macForTopic = String(macTopicStr);

    // Build topic names
    topicEvents = "musicbox/devices/" + macForTopic + "/events";
    topicCommands = "musicbox/devices/" + macForTopic + "/commands";
    topicStatus = "musicbox/devices/" + macForTopic + "/status";

    Serial.printf("[MQTT] Device MAC: %s\n", deviceMac.c_str());
    Serial.printf("[MQTT] Events topic: %s\n", topicEvents.c_str());
    Serial.printf("[MQTT] Commands topic: %s\n", topicCommands.c_str());

    // Setup message callback
    mqttClient.setCallback(onMqttMessage);
    // Must exceed the largest payload plus its MQTT header. Log batches are
    // the biggest thing published, and PubSubClient drops an oversized publish
    // silently — no error, no partial send — so a too-small buffer looks like
    // a device that has gone quiet.
    mqttClient.setBufferSize(4096);

    statusQueue = xQueueCreate(STATUS_QUEUE_SIZE, sizeof(PlaybackStatusMsg));
    if (statusQueue == NULL) {
        Serial.println("[MQTT] Failed to create status queue");
    }
}

// Actually publish a playback status. Core 1 only — called from mqtt_loop().
static void publishPlaybackStatusNow(const PlaybackStatusMsg& msg) {
    JsonDocument doc;
    doc["type"] = "playback_status";
    doc["status"] = msg.status;
    doc["mediaId"] = msg.mediaId;
    doc["position"] = msg.position;

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
}

// Drain queued playback statuses. Core 1 only.
static void drainStatusQueue() {
    if (statusQueue == NULL) return;

    PlaybackStatusMsg msg;
    while (xQueueReceive(statusQueue, &msg, 0) == pdTRUE) {
        publishPlaybackStatusNow(msg);
    }
}

bool mqtt_discover_broker() {
    const DeviceConfig* cfg = config_get();

    // Fetch MQTT config from server
    char url[256];
    snprintf(url, sizeof(url), "%s/api/device/config", cfg->api_base_url);

    Serial.printf("[MQTT] Fetching broker config from %s\n", url);

    HTTPClient http;
    http.begin(url);
    http.setTimeout(10000);

    int httpCode = http.GET();
    if (httpCode == 200) {
        String payload = http.getString();
        http.end();

        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, payload);
        if (!error && doc["mqtt"]["host"].is<const char*>()) {
            const char* host = doc["mqtt"]["host"];
            uint16_t port = doc["mqtt"]["port"] | 1883;

            brokerHost = host;
            brokerPort = port;
            brokerDiscovered = true;

            // Cache in NVS for offline fallback
            config_set_mqtt(host, port);

            // Parse stream base URL if present
            if (doc["streamBaseUrl"].is<const char*>()) {
                const char* streamUrl = doc["streamBaseUrl"];
                config_set_stream_url(streamUrl);
            }

            Serial.printf("[MQTT] Broker discovered: %s:%d\n", brokerHost.c_str(), brokerPort);
            return true;
        }

        Serial.println("[MQTT] Failed to parse broker config");
    } else {
        http.end();
        Serial.printf("[MQTT] Config fetch failed: HTTP %d\n", httpCode);
    }

    // Fallback: use cached NVS values
    if (cfg->mqtt_host[0] != '\0') {
        brokerHost = cfg->mqtt_host;
        brokerPort = cfg->mqtt_port;
        brokerDiscovered = true;
        Serial.printf("[MQTT] Using cached broker: %s:%d\n", brokerHost.c_str(), brokerPort);
        return true;
    }

    Serial.println("[MQTT] No broker available");
    return false;
}

void mqtt_connect() {
    if (!brokerDiscovered) {
        Serial.println("[MQTT] No broker discovered, cannot connect");
        return;
    }

    Serial.printf("[MQTT] Connecting to %s:%d...\n", brokerHost.c_str(), brokerPort);

    mqttClient.setServer(brokerHost.c_str(), brokerPort);

    // Create LWT message
    String lwtTopic = topicStatus;
    String lwtMessage = "{\"online\":false}";

    if (mqttClient.connect(deviceMac.c_str(), NULL, NULL, lwtTopic.c_str(), 1, true, lwtMessage.c_str())) {
        Serial.println("[MQTT] Connected to broker");

        // Publish online status (retained)
        String status = "{\"online\":true}";
        mqttClient.publish(topicStatus.c_str(), status.c_str(), true);

        // Subscribe to commands
        mqttClient.subscribe(topicCommands.c_str(), 1);
        Serial.printf("[MQTT] Subscribed to: %s\n", topicCommands.c_str());

        // Register with server
        publishRegistration();
    } else {
        Serial.printf("[MQTT] Connection failed, rc=%d\n", mqttClient.state());
    }
}

void mqtt_loop() {
    if (mqttClient.connected()) {
        mqttClient.loop();
        drainStatusQueue();
    } else if (brokerDiscovered) {
        // Handle reconnection
        unsigned long now = millis();
        if (now - lastReconnectAttempt > reconnectInterval) {
            lastReconnectAttempt = now;
            Serial.println("[MQTT] Attempting reconnection...");
            mqtt_connect();
        }
    }
}

bool mqtt_is_connected() {
    return mqttClient.connected();
}

static void publishRegistration() {
    JsonDocument doc;
    doc["mac"] = deviceMac;
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    doc["ip"] = WiFi.localIP().toString();

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish("musicbox/register", payload.c_str());
    Serial.println("[MQTT] Published registration");
}

static void onMqttMessage(char* topic, byte* payload, unsigned int length) {
    // Null-terminate payload
    char* message = (char*)malloc(length + 1);
    memcpy(message, payload, length);
    message[length] = '\0';

    Serial.printf("[MQTT] Message on %s: %s\n", topic, message);

    // Parse JSON
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, message);
    free(message);

    if (error) {
        Serial.printf("[MQTT] JSON parse error: %s\n", error.c_str());
        return;
    }

    // Handle commands
    const char* command = doc["command"];
    if (!command) return;

    if (strcmp(command, "play") == 0 && onPlayCb) {
        const char* url = doc["url"];
        int mediaId = doc["mediaId"] | 0;
        onPlayCb(url, mediaId);
    }
    else if (strcmp(command, "pause") == 0 && onPauseCb) {
        onPauseCb();
    }
    else if (strcmp(command, "resume") == 0 && onResumeCb) {
        onResumeCb();
    }
    else if (strcmp(command, "stop") == 0 && onStopCb) {
        onStopCb();
    }
    else if (strcmp(command, "volume") == 0 && onVolumeCb) {
        int level = doc["level"] | 10;
        onVolumeCb(level);
    }
    else if (strcmp(command, "ota") == 0 && onOtaCb) {
        const char* url = doc["url"];
        const char* version = doc["version"];
        const char* sha256 = doc["sha256"];
        onOtaCb(url, version, sha256);
    }
    else if (strcmp(command, "config") == 0) {
        const char* status = doc["status"];
        if (status && strcmp(status, "approved") == 0 && onApprovedCb) {
            onApprovedCb();
        }
        // Handle maxVolume setting
        if (doc["maxVolume"].is<int>()) {
            int maxVol = doc["maxVolume"] | 42;
            audio_set_max_volume(maxVol);
            Serial.printf("[MQTT] Max volume set to: %d\n", maxVol);
        }
    }
    else if (strcmp(command, "error_sound") == 0 && onErrorSoundCb) {
        onErrorSoundCb();
    }
    else if (strcmp(command, "soundmachine_config") == 0 && onSoundMachineConfigCb) {
        // A null url clears the configuration.
        const char* url = doc["url"].is<const char*>() ? doc["url"] : nullptr;
        const char* name = doc["name"].is<const char*>() ? doc["name"] : nullptr;
        int volume = doc["volume"] | -1;  // -1 means leave the current volume
        onSoundMachineConfigCb(url, name, volume);
    }
}

void mqtt_publish_card_scanned(const char* uid) {
    if (!mqttClient.connected()) return;

    JsonDocument doc;
    doc["type"] = "card_scanned";
    doc["uid"] = uid;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
    Serial.printf("[MQTT] Published card scan: %s\n", uid);
}

void mqtt_publish_playback_status(const char* status, int mediaId, int position) {
    if (statusQueue == NULL || status == NULL) return;

    PlaybackStatusMsg msg = {};
    strncpy(msg.status, status, sizeof(msg.status) - 1);
    msg.mediaId = mediaId;
    msg.position = position;

    if (xQueueSend(statusQueue, &msg, 0) != pdTRUE) {
        // Queue full: discard the oldest so the most recent status still gets
        // through. Status is telemetry — the latest value is what matters.
        PlaybackStatusMsg discarded;
        xQueueReceive(statusQueue, &discarded, 0);
        xQueueSend(statusQueue, &msg, 0);
    }
}

void mqtt_publish_skip(const char* direction, uint32_t elapsedSec) {
    if (!mqttClient.connected()) return;

    JsonDocument doc;
    doc["type"] = "skip";
    doc["direction"] = direction;
    // The server needs this to tell "go back a track" from "restart this one".
    doc["elapsed"] = elapsedSec;

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
    Serial.printf("[MQTT] Published skip %s (elapsed %us)\n", direction, (unsigned)elapsedSec);
}

bool mqtt_publish_logs(const char* logs) {
    if (!mqttClient.connected() || !logs || logs[0] == '\0') return false;

    JsonDocument doc;
    doc["type"] = "device_logs";
    doc["logs"] = logs;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    return mqttClient.publish(topicEvents.c_str(), payload.c_str());
}

// Callback registration
void mqtt_on_play(PlayCallback callback) { onPlayCb = callback; }
void mqtt_on_pause(PauseCallback callback) { onPauseCb = callback; }
void mqtt_on_resume(ResumeCallback callback) { onResumeCb = callback; }
void mqtt_on_stop(StopCallback callback) { onStopCb = callback; }
void mqtt_on_volume(VolumeCallback callback) { onVolumeCb = callback; }
void mqtt_on_ota(OtaCallback callback) { onOtaCb = callback; }
void mqtt_on_approved(ApprovedCallback callback) { onApprovedCb = callback; }
void mqtt_on_error_sound(ErrorSoundCallback callback) { onErrorSoundCb = callback; }
void mqtt_on_soundmachine_config(SoundMachineConfigCallback callback) { onSoundMachineConfigCb = callback; }
