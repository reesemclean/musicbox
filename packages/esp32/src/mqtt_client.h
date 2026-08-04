#ifndef MQTT_CLIENT_H
#define MQTT_CLIENT_H

#include <Arduino.h>
#include <functional>

// ─────────────────────────────────────────────────────────────────────────────
// THREADING INVARIANT
//
// PubSubClient and its WiFiClient are NOT thread-safe. Every call into the
// client happens on the task that runs mqtt_loop() — the Arduino loop task.
//
// Anything originating on the audio task must hand off through a queue drained
// in mqtt_loop(). mqtt_publish_playback_status() is the one such path today; a
// new publisher reachable from the audio task needs the same treatment rather
// than a direct call.
// ─────────────────────────────────────────────────────────────────────────────

// Play a URL — a single item, or a playlist the server serves as one
// continuous stream. The device treats both identically.
typedef std::function<void(const char* url, int mediaId)> PlayCallback;
typedef std::function<void()> PauseCallback;
typedef std::function<void()> ResumeCallback;
typedef std::function<void()> StopCallback;
typedef std::function<void(int level)> VolumeCallback;
typedef std::function<void(const char* url, const char* version, const char* sha256)> OtaCallback;
typedef std::function<void()> ApprovedCallback;
typedef std::function<void()> ErrorSoundCallback;
// Sound machine configuration to store locally, so a long-press needs no
// round trip. A null url clears it.
typedef std::function<void(const char* url, const char* name, int volume)> SoundMachineConfigCallback;

void mqtt_init();
void mqtt_loop();
bool mqtt_is_connected();

bool mqtt_discover_broker();
void mqtt_connect();

// Events
void mqtt_publish_card_scanned(const char* uid);
void mqtt_publish_playback_status(const char* status, int mediaId, int position);
// A physical next/previous press. The device resolves nothing itself; the
// server answers with a fresh play. Elapsed lets it choose between going back
// a track and restarting the current one.
void mqtt_publish_skip(const char* direction, uint32_t elapsedSec);
// Returns false if the publish was rejected — most likely too large for the
// client buffer, which PubSubClient otherwise fails silently.
bool mqtt_publish_logs(const char* logs);

// Command callbacks
void mqtt_on_play(PlayCallback callback);
void mqtt_on_pause(PauseCallback callback);
void mqtt_on_resume(ResumeCallback callback);
void mqtt_on_stop(StopCallback callback);
void mqtt_on_volume(VolumeCallback callback);
void mqtt_on_ota(OtaCallback callback);
void mqtt_on_approved(ApprovedCallback callback);
void mqtt_on_error_sound(ErrorSoundCallback callback);
void mqtt_on_soundmachine_config(SoundMachineConfigCallback callback);

#endif
