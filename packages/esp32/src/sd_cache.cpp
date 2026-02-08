#include "sd_cache.h"
#include "device_config.h"
#include "card_cache.h"
#include <SPI.h>
#include <SD.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <set>

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache index
// ─────────────────────────────────────────────────────────────────────────────

static std::set<int> cachedMediaIds;
static SemaphoreHandle_t indexMutex = NULL;
static volatile bool sdAvailable = false;

// ─────────────────────────────────────────────────────────────────────────────
// Download queue and state
// ─────────────────────────────────────────────────────────────────────────────

struct DownloadRequest {
    int mediaId;
    char url[256];
};

#define DOWNLOAD_QUEUE_SIZE 50
static QueueHandle_t downloadQueue = NULL;

// Current download state (only accessed from Core 0)
static bool downloading = false;
static int currentMediaId = -1;
static HTTPClient* httpClient = NULL;
static WiFiClient* stream = NULL;
static File currentFile;
static char currentTempPath[64];   // Fixed size to avoid heap fragmentation
static char currentFinalPath[64];  // Fixed size to avoid heap fragmentation
static int totalBytes = 0;
static int bytesWritten = 0;
static unsigned long downloadStartTime = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Forward declarations
// ─────────────────────────────────────────────────────────────────────────────

static void buildCacheIndex();
static void indexAdd(int mediaId);
static void indexRemove(int mediaId);
static bool startDownload(int mediaId, const char* url);
static bool processDownloadChunk();
static void finishDownload(bool success);
static void cleanupTempFiles();

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

bool sd_cache_init() {
    Serial.println("[SD Cache] Initializing...");

    // Verify PSRAM is available (needed for audio buffers)
    Serial.printf("[SD Cache] PSRAM: %d KB total, %d KB free\n",
        ESP.getPsramSize() / 1024, ESP.getFreePsram() / 1024);

    // Create index mutex
    indexMutex = xSemaphoreCreateMutex();
    if (indexMutex == NULL) {
        Serial.println("[SD Cache] Failed to create index mutex");
        return false;
    }

    // Create download queue
    downloadQueue = xQueueCreate(DOWNLOAD_QUEUE_SIZE, sizeof(DownloadRequest));
    if (downloadQueue == NULL) {
        Serial.println("[SD Cache] Failed to create download queue");
        return false;
    }

    // Initialize SPI for SD card
    pinMode(SD_CS, OUTPUT);
    digitalWrite(SD_CS, HIGH);
    SPI.begin(SD_CLK, SD_MISO, SD_MOSI);

    // Initialize SD card
    if (!SD.begin(SD_CS)) {
        Serial.println("[SD Cache] SD card mount failed - caching disabled");
        sdAvailable = false;
        return false;
    }

    // Check card type
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        Serial.println("[SD Cache] No SD card attached - caching disabled");
        sdAvailable = false;
        return false;
    }

    const char* cardTypeStr = "UNKNOWN";
    if (cardType == CARD_MMC) cardTypeStr = "MMC";
    else if (cardType == CARD_SD) cardTypeStr = "SDSC";
    else if (cardType == CARD_SDHC) cardTypeStr = "SDHC";

    uint64_t cardSize = SD.cardSize() / (1024 * 1024);
    uint64_t totalBytes = SD.totalBytes() / (1024 * 1024);
    uint64_t usedBytes = SD.usedBytes() / (1024 * 1024);

    Serial.printf("[SD Cache] Card: %s, Size: %llu MB, Used: %llu MB, Free: %llu MB\n",
        cardTypeStr, cardSize, usedBytes, totalBytes - usedBytes);

    // Create cache directory if it doesn't exist
    if (!SD.exists(CACHE_DIR)) {
        if (SD.mkdir(CACHE_DIR)) {
            Serial.println("[SD Cache] Created cache directory");
        } else {
            Serial.println("[SD Cache] Failed to create cache directory");
            sdAvailable = false;
            return false;
        }
    }

    // Clean up any orphaned temp files
    cleanupTempFiles();

    // TODO: Remove this once stable - clear cache on boot for testing
    // sd_cache_clear();

    // Build in-memory index by scanning /cache
    buildCacheIndex();

    sdAvailable = true;
    Serial.println("[SD Cache] Ready");
    return true;
}

bool sd_cache_available() {
    return sdAvailable;
}

bool sd_cache_has(int mediaId) {
    if (!sdAvailable || indexMutex == NULL) return false;

    // Thread-safe in-memory lookup - NO SD access
    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(10)) != pdTRUE) {
        return false;  // Couldn't get mutex, assume not cached
    }

    bool found = cachedMediaIds.count(mediaId) > 0;
    xSemaphoreGive(indexMutex);
    return found;
}

String sd_cache_path(int mediaId) {
    return String(CACHE_DIR) + "/" + String(mediaId) + ".mp3";
}

void sd_cache_queue_download(int mediaId, const char* url) {
    if (!sdAvailable || downloadQueue == NULL) return;

    // Don't queue if already cached
    if (sd_cache_has(mediaId)) {
        return;
    }

    // Don't queue if currently downloading this file
    if (currentMediaId == mediaId) {
        return;
    }

    DownloadRequest req;
    req.mediaId = mediaId;
    strncpy(req.url, url, sizeof(req.url) - 1);
    req.url[sizeof(req.url) - 1] = '\0';

    // Non-blocking send - drop if queue is full
    if (xQueueSend(downloadQueue, &req, 0) == pdTRUE) {
        Serial.printf("[SD Cache] Queued for download: %d\n", mediaId);
    }
}

// Forward declaration
static void processEviction();

void sd_cache_process() {
    if (!sdAvailable) return;

    // If currently downloading, process a chunk
    if (downloading) {
        if (!processDownloadChunk()) {
            // Download failed or complete
            finishDownload(bytesWritten > 0 && (totalBytes < 0 || bytesWritten >= totalBytes));
        }
        return;
    }

    // Check for new download request (priority over eviction)
    DownloadRequest req;
    if (xQueueReceive(downloadQueue, &req, 0) == pdTRUE) {
        // Skip if already cached (might have been downloaded while queued)
        if (sd_cache_has(req.mediaId)) {
            return;
        }

        startDownload(req.mediaId, req.url);
        return;
    }

    // Process evictions when not downloading
    processEviction();
}

int sd_cache_file_count() {
    if (!sdAvailable || indexMutex == NULL) return 0;

    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) != pdTRUE) {
        return 0;
    }
    int count = cachedMediaIds.size();
    xSemaphoreGive(indexMutex);
    return count;
}

void sd_cache_remove(int mediaId) {
    if (indexMutex == NULL) return;

    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        cachedMediaIds.erase(mediaId);
        xSemaphoreGive(indexMutex);
        Serial.printf("[SD Cache] Removed from index: %d\n", mediaId);
    }
}

void sd_cache_clear() {
    if (!sdAvailable) {
        Serial.println("[SD Cache] Clear skipped - SD not available");
        return;
    }

    Serial.println("[SD Cache] Clearing all cached files...");

    File dir = SD.open(CACHE_DIR);
    if (!dir) {
        Serial.println("[SD Cache] Failed to open cache dir for clearing");
        return;
    }

    int deleted = 0;
    int failed = 0;
    File file = dir.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            String name = file.name();
            Serial.printf("[SD Cache] Found file: %s\n", name.c_str());

            // file.name() may return full path or just filename
            int lastSlash = name.lastIndexOf('/');
            String filename = (lastSlash >= 0) ? name.substring(lastSlash + 1) : name;
            String fullPath = String(CACHE_DIR) + "/" + filename;

            Serial.printf("[SD Cache] Deleting: %s\n", fullPath.c_str());
            file.close();

            if (SD.remove(fullPath)) {
                deleted++;
                Serial.printf("[SD Cache] Deleted OK\n");
            } else {
                failed++;
                Serial.printf("[SD Cache] Delete FAILED\n");
            }

            // Re-open directory (iterator invalidated after delete)
            dir.close();  // Close old handle first!
            dir = SD.open(CACHE_DIR);
            file = dir.openNextFile();
            continue;
        }
        file.close();  // Close directories too
        file = dir.openNextFile();
    }
    dir.close();

    // Clear the in-memory index
    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        cachedMediaIds.clear();
        xSemaphoreGive(indexMutex);
    }

    Serial.printf("[SD Cache] Cleared %d file(s), %d failed\n", deleted, failed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal functions (Core 0 only)
// ─────────────────────────────────────────────────────────────────────────────

static void buildCacheIndex() {
    Serial.println("[SD Cache] Building index...");

    File dir = SD.open(CACHE_DIR);
    if (!dir) {
        Serial.println("[SD Cache] Failed to open cache directory");
        return;
    }

    int count = 0;
    File file = dir.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            String name = file.name();

            // file.name() may return full path or just filename depending on ESP32 core version
            // Extract just the filename if it contains a path
            int lastSlash = name.lastIndexOf('/');
            if (lastSlash >= 0) {
                name = name.substring(lastSlash + 1);
            }

            // Skip temp files
            if (!name.startsWith("tmp_")) {
                int mediaId = name.toInt();
                if (mediaId > 0) {
                    cachedMediaIds.insert(mediaId);
                    count++;
                    Serial.printf("[SD Cache] Found: %d.mp3\n", mediaId);
                }
            }
        }
        file.close();  // Must close each file!
        file = dir.openNextFile();
    }
    dir.close();

    Serial.printf("[SD Cache] Index built: %d files\n", count);
}

static void indexAdd(int mediaId) {
    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        cachedMediaIds.insert(mediaId);
        xSemaphoreGive(indexMutex);
    }
}

static void indexRemove(int mediaId) {
    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        cachedMediaIds.erase(mediaId);
        xSemaphoreGive(indexMutex);
    }
}

static bool startDownload(int mediaId, const char* url) {
    if (!WiFi.isConnected()) {
        Serial.println("[SD Cache] WiFi not connected");
        return false;
    }

    Serial.printf("[SD Cache] Starting download: %d\n", mediaId);

    httpClient = new HTTPClient();
    httpClient->begin(url);
    httpClient->setTimeout(30000);

    int httpCode = httpClient->GET();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[SD Cache] HTTP error: %d\n", httpCode);
        delete httpClient;
        httpClient = NULL;
        return false;
    }

    totalBytes = httpClient->getSize();
    stream = httpClient->getStreamPtr();

    // Open temp file for writing
    snprintf(currentTempPath, sizeof(currentTempPath), "%s/tmp_%d.mp3", CACHE_DIR, mediaId);
    snprintf(currentFinalPath, sizeof(currentFinalPath), "%s/%d.mp3", CACHE_DIR, mediaId);

    if (SD.exists(currentTempPath)) {
        SD.remove(currentTempPath);
    }

    currentFile = SD.open(currentTempPath, FILE_WRITE);
    if (!currentFile) {
        Serial.println("[SD Cache] Failed to open file for writing");
        httpClient->end();
        delete httpClient;
        httpClient = NULL;
        return false;
    }

    currentMediaId = mediaId;
    bytesWritten = 0;
    downloadStartTime = millis();
    downloading = true;

    Serial.printf("[SD Cache] Downloading %d bytes...\n", totalBytes);
    return true;
}

static bool processDownloadChunk() {
    if (!httpClient || !stream) {
        return false;
    }

    // Check for timeout (2 minutes)
    if (millis() - downloadStartTime > 120000) {
        Serial.println("[SD Cache] Download timeout");
        return false;
    }

    // Check if connection still valid
    if (!httpClient->connected() && !stream->available()) {
        // Connection closed - check if we got all data
        return false;
    }

    // Read available data (up to 1KB per call to keep it non-blocking)
    size_t available = stream->available();
    if (available > 0) {
        uint8_t buffer[1024];
        size_t toRead = min(available, sizeof(buffer));
        size_t bytesRead = stream->readBytes(buffer, toRead);

        if (bytesRead > 0) {
            size_t written = currentFile.write(buffer, bytesRead);
            bytesWritten += written;
        }
    }

    // Check if download complete
    if (totalBytes > 0 && bytesWritten >= totalBytes) {
        return false;  // Done
    }

    return true;  // Continue
}

static void finishDownload(bool success) {
    currentFile.close();

    if (success) {
        // Rename temp to final
        if (SD.exists(currentFinalPath)) {
            SD.remove(currentFinalPath);
        }

        if (SD.rename(currentTempPath, currentFinalPath)) {
            unsigned long elapsed = millis() - downloadStartTime;
            float speed = (float)bytesWritten / elapsed;
            Serial.printf("[SD Cache] Downloaded: %d (%d bytes, %.1f KB/s)\n",
                currentMediaId, bytesWritten, speed);

            // Add to index
            indexAdd(currentMediaId);
        } else {
            Serial.println("[SD Cache] Failed to rename temp file");
            SD.remove(currentTempPath);
        }
    } else {
        Serial.printf("[SD Cache] Download failed: %d\n", currentMediaId);
        SD.remove(currentTempPath);
    }

    // Cleanup
    if (httpClient) {
        httpClient->end();
        delete httpClient;
        httpClient = NULL;
    }
    stream = NULL;
    currentMediaId = -1;
    downloading = false;
}

static void cleanupTempFiles() {
    File dir = SD.open(CACHE_DIR);
    if (!dir) return;

    int cleaned = 0;
    File file = dir.openNextFile();
    while (file) {
        if (!file.isDirectory()) {
            String name = file.name();

            // file.name() may return full path or just filename
            int lastSlash = name.lastIndexOf('/');
            String filename = (lastSlash >= 0) ? name.substring(lastSlash + 1) : name;

            if (filename.startsWith("tmp_")) {
                String fullPath = String(CACHE_DIR) + "/" + filename;
                file.close();
                if (SD.remove(fullPath)) {
                    cleaned++;
                }
                dir.close();  // Close old handle first!
                dir = SD.open(CACHE_DIR);
                file = dir.openNextFile();
                continue;
            }
        }
        file.close();  // Must close each file!
        file = dir.openNextFile();
    }
    dir.close();

    if (cleaned > 0) {
        Serial.printf("[SD Cache] Cleaned %d temp file(s)\n", cleaned);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eager download and eviction
// ─────────────────────────────────────────────────────────────────────────────

// Eviction queue - files to delete when idle
#define EVICTION_QUEUE_SIZE 50
static QueueHandle_t evictionQueue = NULL;

static void initEvictionQueue() {
    if (evictionQueue == NULL) {
        evictionQueue = xQueueCreate(EVICTION_QUEUE_SIZE, sizeof(int));
    }
}

// Process one eviction (called from Core 0 when idle)
static void processEviction() {
    if (evictionQueue == NULL) return;

    int mediaId;
    if (xQueueReceive(evictionQueue, &mediaId, 0) == pdTRUE) {
        char path[64];
        snprintf(path, sizeof(path), "%s/%d.mp3", CACHE_DIR, mediaId);

        if (SD.exists(path)) {
            if (SD.remove(path)) {
                Serial.printf("[SD Cache] Evicted: %d\n", mediaId);
            } else {
                Serial.printf("[SD Cache] Failed to evict: %d\n", mediaId);
            }
        }

        // Remove from index
        indexRemove(mediaId);
    }
}

void sd_cache_sync_with_cards() {
    if (!sdAvailable) return;

    initEvictionQueue();

    Serial.println("[SD Cache] Syncing with card cache...");

    // Get all media IDs that should be cached (from card cache)
    static int wantedIds[MAX_CACHED_CARDS * MAX_TRACKS_PER_CARD];
    int wantedCount = card_cache_get_all_media_ids(wantedIds, sizeof(wantedIds) / sizeof(wantedIds[0]));

    Serial.printf("[SD Cache] Cards reference %d unique media files\n", wantedCount);

    // Build a set of wanted IDs for fast lookup
    std::set<int> wantedSet;
    for (int i = 0; i < wantedCount; i++) {
        wantedSet.insert(wantedIds[i]);
    }

    // 1. Queue downloads for files we want but don't have
    int queuedDownloads = 0;
    for (int i = 0; i < wantedCount; i++) {
        int mediaId = wantedIds[i];
        if (!sd_cache_has(mediaId)) {
            // Build URL and queue download
            char url[256];
            snprintf(url, sizeof(url), "%s/api/media/stream/%d",
                     config_stream_base_url(), mediaId);
            sd_cache_queue_download(mediaId, url);
            queuedDownloads++;
        }
    }

    // 2. Queue eviction for files we have but don't want
    int queuedEvictions = 0;
    if (xSemaphoreTake(indexMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        // Iterate over cached IDs and find orphans
        for (int cachedId : cachedMediaIds) {
            if (wantedSet.find(cachedId) == wantedSet.end()) {
                // This file is cached but not on any card - evict it
                if (xQueueSend(evictionQueue, &cachedId, 0) == pdTRUE) {
                    queuedEvictions++;
                }
            }
        }
        xSemaphoreGive(indexMutex);
    }

    Serial.printf("[SD Cache] Sync: %d to download, %d to evict\n",
        queuedDownloads, queuedEvictions);
}
