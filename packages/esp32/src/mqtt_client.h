#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <Arduino.h>
#include <functional>

// Callback types
typedef std::function<void(const char* url, int mediaId)> PlayCallback;
typedef std::function<void(const char* url, int mediaId)> QueueCallback;
typedef std::function<void()> PauseCallback;
typedef std::function<void()> ResumeCallback;
typedef std::function<void()> StopCallback;
typedef std::function<void(int level)> VolumeCallback;
typedef std::function<void(const char* url, const char* version, const char* sha256)> OtaCallback;
typedef std::function<void()> ApprovedCallback;
typedef std::function<void()> ErrorSoundCallback;
typedef std::function<void(const char* url, const char* name, int volume)> SoundMachineCallback;

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
void mqtt_publish_card_played_locally(const char* uid);  // Card handled from cache, no commands needed
void mqtt_publish_playback_status(const char* status, int mediaId, int position);
void mqtt_publish_soundmachine_request();

// Register command callbacks
void mqtt_on_play(PlayCallback callback);
void mqtt_on_queue(QueueCallback callback);
void mqtt_on_pause(PauseCallback callback);
void mqtt_on_resume(ResumeCallback callback);
void mqtt_on_stop(StopCallback callback);
void mqtt_on_volume(VolumeCallback callback);
void mqtt_on_ota(OtaCallback callback);
void mqtt_on_approved(ApprovedCallback callback);
void mqtt_on_error_sound(ErrorSoundCallback callback);
void mqtt_on_soundmachine(SoundMachineCallback callback);

#endif
