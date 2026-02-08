#include "mqtt_client.h"
#include "device_config.h"
#include "card_cache.h"
#include "sd_cache.h"
#include "audio_player.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <esp_mac.h>

// WiFi client for MQTT
static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);

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
static QueueCallback onQueueCb = nullptr;
static PauseCallback onPauseCb = nullptr;
static ResumeCallback onResumeCb = nullptr;
static StopCallback onStopCb = nullptr;
static VolumeCallback onVolumeCb = nullptr;
static OtaCallback onOtaCb = nullptr;
static ApprovedCallback onApprovedCb = nullptr;
static ErrorSoundCallback onErrorSoundCb = nullptr;
static SoundMachineCallback onSoundMachineCb = nullptr;

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
    mqttClient.setBufferSize(1024);  // Increase buffer for larger messages
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
    else if (strcmp(command, "queue") == 0 && onQueueCb) {
        const char* url = doc["url"];
        int mediaId = doc["mediaId"] | 0;
        onQueueCb(url, mediaId);
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
    else if (strcmp(command, "sync_cards") == 0) {
        // Full card cache sync
        card_cache_clear();
        JsonArray cards = doc["cards"];
        for (JsonObject card : cards) {
            const char* uid = card["uid"];
            int volume = card["volume"] | -1;
            const char* typeStr = card["type"] | "song";
            CardType type = CARD_TYPE_SONG;
            if (strcmp(typeStr, "podcast") == 0) {
                type = CARD_TYPE_PODCAST;
            } else if (strcmp(typeStr, "playlist") == 0) {
                type = CARD_TYPE_PLAYLIST;
            }
            JsonArray mediaIds = card["mediaIds"];
            int ids[MAX_TRACKS_PER_CARD];
            int count = 0;
            for (int id : mediaIds) {
                if (count < MAX_TRACKS_PER_CARD) {
                    ids[count++] = id;
                }
            }
            card_cache_set(uid, ids, count, volume, type);
        }
        Serial.printf("[MQTT] Synced %d cards\n", card_cache_count());
        sd_cache_sync_with_cards();  // Eager download & eviction
    }
    else if (strcmp(command, "card_update") == 0) {
        // Single card update
        const char* uid = doc["uid"];
        int volume = doc["volume"] | -1;
        const char* typeStr = doc["type"] | "song";
        CardType type = CARD_TYPE_SONG;
        if (strcmp(typeStr, "podcast") == 0) {
            type = CARD_TYPE_PODCAST;
        } else if (strcmp(typeStr, "playlist") == 0) {
            type = CARD_TYPE_PLAYLIST;
        }
        JsonArray mediaIds = doc["mediaIds"];
        int ids[MAX_TRACKS_PER_CARD];
        int count = 0;
        for (int id : mediaIds) {
            if (count < MAX_TRACKS_PER_CARD) {
                ids[count++] = id;
            }
        }
        card_cache_set(uid, ids, count, volume, type);
        sd_cache_sync_with_cards();  // Eager download & eviction
    }
    else if (strcmp(command, "card_delete") == 0) {
        const char* uid = doc["uid"];
        card_cache_remove(uid);
        sd_cache_sync_with_cards();  // Evict orphaned files
    }
    else if (strcmp(command, "clear_cache") == 0) {
        Serial.println("[MQTT] Clear cache command received");
        card_cache_clear();
        sd_cache_clear();
        Serial.println("[MQTT] Cache cleared");
    }
    else if (strcmp(command, "error_sound") == 0 && onErrorSoundCb) {
        onErrorSoundCb();
    }
    else if (strcmp(command, "soundmachine") == 0 && onSoundMachineCb) {
        const char* url = doc["url"];
        const char* name = doc["name"];
        int volume = doc["volume"] | -1;  // -1 means use current volume
        onSoundMachineCb(url, name, volume);
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

void mqtt_publish_card_played_locally(const char* uid) {
    if (!mqttClient.connected()) return;

    JsonDocument doc;
    doc["type"] = "card_played_locally";
    doc["uid"] = uid;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
    Serial.printf("[MQTT] Published card played locally: %s\n", uid);
}

void mqtt_publish_playback_status(const char* status, int mediaId, int position) {
    if (!mqttClient.connected()) return;

    JsonDocument doc;
    doc["type"] = "playback_status";
    doc["status"] = status;
    doc["mediaId"] = mediaId;
    doc["position"] = position;

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
}

void mqtt_publish_soundmachine_request() {
    if (!mqttClient.connected()) return;

    JsonDocument doc;
    doc["type"] = "soundmachine_request";
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
    Serial.println("[MQTT] Published sound machine request");
}

void mqtt_publish_logs(const char* logs) {
    if (!mqttClient.connected() || !logs || logs[0] == '\0') return;

    JsonDocument doc;
    doc["type"] = "device_logs";
    doc["logs"] = logs;
    doc["timestamp"] = millis();

    String payload;
    serializeJson(doc, payload);

    mqttClient.publish(topicEvents.c_str(), payload.c_str());
}

// Callback registration
void mqtt_on_play(PlayCallback callback) { onPlayCb = callback; }
void mqtt_on_queue(QueueCallback callback) { onQueueCb = callback; }
void mqtt_on_pause(PauseCallback callback) { onPauseCb = callback; }
void mqtt_on_resume(ResumeCallback callback) { onResumeCb = callback; }
void mqtt_on_stop(StopCallback callback) { onStopCb = callback; }
void mqtt_on_volume(VolumeCallback callback) { onVolumeCb = callback; }
void mqtt_on_ota(OtaCallback callback) { onOtaCb = callback; }
void mqtt_on_approved(ApprovedCallback callback) { onApprovedCb = callback; }
void mqtt_on_error_sound(ErrorSoundCallback callback) { onErrorSoundCb = callback; }
void mqtt_on_soundmachine(SoundMachineCallback callback) { onSoundMachineCb = callback; }
