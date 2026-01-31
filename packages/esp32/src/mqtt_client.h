#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <Arduino.h>
#include <functional>

// Callback types
typedef std::function<void(const char* url, int mediaId)> PlayCallback;
typedef std::function<void()> PauseCallback;
typedef std::function<void()> ResumeCallback;
typedef std::function<void()> StopCallback;
typedef std::function<void(int level)> VolumeCallback;
typedef std::function<void(const char* url, const char* version)> OtaCallback;
typedef std::function<void()> ApprovedCallback;

// Initialize MQTT client
void mqtt_init();

// Call in loop() to handle MQTT
void mqtt_loop();

// Check if connected
bool mqtt_is_connected();

// Discover broker via mDNS
bool mqtt_discover_broker();

// Connect to broker (call after WiFi is connected)
void mqtt_connect();

// Publish events
void mqtt_publish_card_scanned(const char* uid);
void mqtt_publish_playback_status(const char* status, int mediaId, int position);

// Register command callbacks
void mqtt_on_play(PlayCallback callback);
void mqtt_on_pause(PauseCallback callback);
void mqtt_on_resume(ResumeCallback callback);
void mqtt_on_stop(StopCallback callback);
void mqtt_on_volume(VolumeCallback callback);
void mqtt_on_ota(OtaCallback callback);
void mqtt_on_approved(ApprovedCallback callback);

#endif
