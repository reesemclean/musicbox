#ifndef SD_CACHE_H
#define SD_CACHE_H

#include <Arduino.h>

// SD Card SPI pins
#define SD_CLK  38
#define SD_MOSI 39
#define SD_MISO 40
#define SD_CS   41

// Cache settings
#define CACHE_DIR "/cache"
#define MIN_FREE_SPACE_MB 100  // Keep at least 100MB free

// Initialize SD card and cache system
// Scans /cache directory and builds in-memory index
// Returns true if SD card is available
// MUST be called from Core 0 (audio task) for SD playback to work
bool sd_cache_init();

// Check if SD card is available
bool sd_cache_available();

// Check if a media file is cached (in-memory lookup, no SD access)
// Thread-safe, can be called from any core
bool sd_cache_has(int mediaId);

// Get the cache file path for a media ID
// Returns path like "/cache/42.mp3"
String sd_cache_path(int mediaId);

// Queue a file for background download
// Thread-safe, can be called from any core
// Actual download happens in sd_cache_process() on Core 0
void sd_cache_queue_download(int mediaId, const char* url);

// Process one chunk of download work (non-blocking)
// MUST be called from Core 0 (audio task) only
// Call this in a loop when audio is idle
void sd_cache_process();

// Get cache statistics
int sd_cache_file_count();

// Remove a file from the cache index (call when file is deleted/invalid)
// Thread-safe, can be called from any core
void sd_cache_remove(int mediaId);

// Clear all cached files (call from Core 0 only)
void sd_cache_clear();

// Sync cache with card cache: queue downloads for missing files, evict orphans
// Thread-safe, can be called from any core (queues work for Core 0)
// Call after sync_cards, card_update, or device approval
void sd_cache_sync_with_cards();

#endif
