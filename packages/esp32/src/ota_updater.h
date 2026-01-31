#ifndef OTA_UPDATER_H
#define OTA_UPDATER_H

#include <functional>

// Callback for OTA progress (0-100)
typedef std::function<void(int progress)> OtaProgressCallback;

// Callback for OTA completion (success, error message if failed)
typedef std::function<void(bool success, const char* message)> OtaCompleteCallback;

// Initialize OTA updater
void ota_init();

// Check for updates (non-blocking, calls complete callback when done)
// Returns true if check was started, false if already in progress
bool ota_check_for_update();

// Start OTA update from URL
// url: firmware download URL
// version: expected version string
// sha256: expected SHA256 hash (hex string, 64 chars) - can be NULL to skip verification
bool ota_start_update(const char* url, const char* version, const char* sha256);

// Check if OTA is in progress
bool ota_is_updating();

// Get current firmware version
const char* ota_get_current_version();

// Register callbacks
void ota_on_progress(OtaProgressCallback callback);
void ota_on_complete(OtaCompleteCallback callback);

#endif
