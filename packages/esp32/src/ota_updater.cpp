#include "ota_updater.h"
#include "device_config.h"
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Update.h>
#include <esp_task_wdt.h>
#include <mbedtls/sha256.h>

// Current firmware version (set during build)
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "1.0.0"
#endif

// State
static bool ota_in_progress = false;
static OtaProgressCallback on_progress = nullptr;
static OtaCompleteCallback on_complete = nullptr;

// SHA256 context for verification
static mbedtls_sha256_context sha256_ctx;
static char expected_sha256[65] = {0};
static bool verify_sha256 = false;

void ota_init() {
    Serial.println("[OTA] Initialized");
    Serial.printf("[OTA] Current version: %s\n", FIRMWARE_VERSION);
}

const char* ota_get_current_version() {
    return FIRMWARE_VERSION;
}

bool ota_is_updating() {
    return ota_in_progress;
}

void ota_on_progress(OtaProgressCallback callback) {
    on_progress = callback;
}

void ota_on_complete(OtaCompleteCallback callback) {
    on_complete = callback;
}

static void emit_progress(int progress) {
    if (on_progress) {
        on_progress(progress);
    }
}

static void emit_complete(bool success, const char* message) {
    ota_in_progress = false;
    if (on_complete) {
        on_complete(success, message);
    }
}

// Convert hex string to bytes
static bool hex_to_bytes(const char* hex, uint8_t* bytes, size_t len) {
    for (size_t i = 0; i < len; i++) {
        char high = hex[i * 2];
        char low = hex[i * 2 + 1];

        uint8_t h = (high >= '0' && high <= '9') ? high - '0' :
                    (high >= 'a' && high <= 'f') ? high - 'a' + 10 :
                    (high >= 'A' && high <= 'F') ? high - 'A' + 10 : 0xFF;
        uint8_t l = (low >= '0' && low <= '9') ? low - '0' :
                    (low >= 'a' && low <= 'f') ? low - 'a' + 10 :
                    (low >= 'A' && low <= 'F') ? low - 'A' + 10 : 0xFF;

        if (h == 0xFF || l == 0xFF) return false;
        bytes[i] = (h << 4) | l;
    }
    return true;
}

// Convert bytes to hex string
static void bytes_to_hex(const uint8_t* bytes, size_t len, char* hex) {
    const char* hexchars = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) {
        hex[i * 2] = hexchars[(bytes[i] >> 4) & 0x0F];
        hex[i * 2 + 1] = hexchars[bytes[i] & 0x0F];
    }
    hex[len * 2] = '\0';
}

bool ota_check_for_update() {
    if (ota_in_progress) {
        Serial.println("[OTA] Already in progress");
        return false;
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[OTA] WiFi not connected");
        return false;
    }

    Serial.println("[OTA] Checking for updates...");

    HTTPClient http;
    char url[128];
    snprintf(url, sizeof(url), "%s/api/firmware/latest", config_stream_base_url());

    http.begin(url);
    http.setTimeout(10000);

    int httpCode = http.GET();

    if (httpCode != 200) {
        Serial.printf("[OTA] Check failed: HTTP %d\n", httpCode);
        http.end();
        return false;
    }

    String payload = http.getString();
    http.end();

    // Parse JSON response
    // Expected: {"version":"1.0.1","sha256":"abc...","fileSize":123456}
    int versionStart = payload.indexOf("\"version\":\"") + 11;
    int versionEnd = payload.indexOf("\"", versionStart);

    if (versionStart < 11 || versionEnd < 0) {
        Serial.println("[OTA] Failed to parse version");
        return false;
    }

    String serverVersion = payload.substring(versionStart, versionEnd);

    Serial.printf("[OTA] Server version: %s, Current: %s\n",
                  serverVersion.c_str(), FIRMWARE_VERSION);

    if (serverVersion == FIRMWARE_VERSION) {
        Serial.println("[OTA] Already up to date");
        return true;
    }

    Serial.println("[OTA] Update available!");
    return true;
}

bool ota_start_update(const char* url, const char* version, const char* sha256) {
    if (ota_in_progress) {
        Serial.println("[OTA] Already in progress");
        return false;
    }

    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[OTA] WiFi not connected");
        emit_complete(false, "WiFi not connected");
        return false;
    }

    Serial.printf("[OTA] Starting update to %s from %s\n", version, url);
    ota_in_progress = true;

    // Setup SHA256 verification if provided
    if (sha256 && strlen(sha256) == 64) {
        verify_sha256 = true;
        strncpy(expected_sha256, sha256, 64);
        expected_sha256[64] = '\0';
        mbedtls_sha256_init(&sha256_ctx);
        mbedtls_sha256_starts(&sha256_ctx, 0); // 0 = SHA256 (not SHA224)
        Serial.printf("[OTA] Will verify SHA256: %.16s...\n", sha256);
    } else {
        verify_sha256 = false;
        Serial.println("[OTA] Warning: No SHA256 verification");
    }

    HTTPClient http;
    http.begin(url);
    http.setTimeout(30000);

    int httpCode = http.GET();

    if (httpCode != 200) {
        Serial.printf("[OTA] Download failed: HTTP %d\n", httpCode);
        http.end();
        emit_complete(false, "Download failed");
        return false;
    }

    int contentLength = http.getSize();
    if (contentLength <= 0) {
        Serial.println("[OTA] Invalid content length");
        http.end();
        emit_complete(false, "Invalid content length");
        return false;
    }

    Serial.printf("[OTA] Firmware size: %d bytes\n", contentLength);

    // Begin OTA update
    if (!Update.begin(contentLength)) {
        Serial.printf("[OTA] Not enough space: %s\n", Update.errorString());
        http.end();
        emit_complete(false, "Not enough space");
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();

    uint8_t buffer[1024];
    int written = 0;
    int lastProgress = 0;

    while (http.connected() && written < contentLength) {
        // This loop owns the CPU until the whole image is flashed, which can
        // exceed the task watchdog timeout on a slow link or a large image.
        // delay() yields to other tasks but does not feed this task's watchdog.
        esp_task_wdt_reset();

        size_t available = stream->available();
        if (available > 0) {
            size_t toRead = min(available, sizeof(buffer));
            size_t bytesRead = stream->readBytes(buffer, toRead);

            if (bytesRead > 0) {
                // Update SHA256 hash
                if (verify_sha256) {
                    mbedtls_sha256_update(&sha256_ctx, buffer, bytesRead);
                }

                // Write to flash
                size_t bytesWritten = Update.write(buffer, bytesRead);
                if (bytesWritten != bytesRead) {
                    Serial.printf("[OTA] Write error: %s\n", Update.errorString());
                    Update.abort();
                    http.end();
                    emit_complete(false, "Write error");
                    return false;
                }

                written += bytesWritten;

                // Report progress
                int progress = (written * 100) / contentLength;
                if (progress != lastProgress) {
                    lastProgress = progress;
                    Serial.printf("[OTA] Progress: %d%%\n", progress);
                    emit_progress(progress);
                }
            }
        }
        delay(1); // Yield to other tasks
    }

    http.end();

    if (written != contentLength) {
        Serial.printf("[OTA] Incomplete: %d/%d bytes\n", written, contentLength);
        Update.abort();
        emit_complete(false, "Incomplete download");
        return false;
    }

    // Verify SHA256 if enabled
    if (verify_sha256) {
        uint8_t hash[32];
        mbedtls_sha256_finish(&sha256_ctx, hash);
        mbedtls_sha256_free(&sha256_ctx);

        char computed_sha256[65];
        bytes_to_hex(hash, 32, computed_sha256);

        Serial.printf("[OTA] Expected SHA256: %s\n", expected_sha256);
        Serial.printf("[OTA] Computed SHA256: %s\n", computed_sha256);

        if (strcasecmp(computed_sha256, expected_sha256) != 0) {
            Serial.println("[OTA] SHA256 mismatch!");
            Update.abort();
            emit_complete(false, "SHA256 verification failed");
            return false;
        }

        Serial.println("[OTA] SHA256 verified");
    }

    // Finalize update
    if (!Update.end(true)) {
        Serial.printf("[OTA] Finalize failed: %s\n", Update.errorString());
        emit_complete(false, "Finalize failed");
        return false;
    }

    Serial.println("[OTA] Update successful! Rebooting...");
    emit_complete(true, "Update successful");

    delay(1000);
    ESP.restart();

    return true; // Won't reach here
}
