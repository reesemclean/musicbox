#ifndef CARD_CACHE_H
#define CARD_CACHE_H

#include <Arduino.h>

#define MAX_CACHED_CARDS 100
#define MAX_TRACKS_PER_CARD 50

// Card content types
enum CardType {
    CARD_TYPE_SONG = 0,     // Single song or playlist (cacheable)
    CARD_TYPE_PLAYLIST = 1, // Playlist (cacheable)
    CARD_TYPE_PODCAST = 2,  // Podcast feed (stream only, don't cache)
};

struct CachedCard {
    char uid[15];           // NFC UID hex string
    int mediaIds[MAX_TRACKS_PER_CARD];
    int trackCount;
    int volume;             // -1 = use current volume
    CardType type;          // Content type (affects caching behavior)
    bool valid;
};

// Initialize the cache
void card_cache_init();

// Look up a card by UID, returns null if not found
CachedCard* card_cache_lookup(const char* uid);

// Add or update a card in the cache
void card_cache_set(const char* uid, int* mediaIds, int trackCount, int volume, CardType type);

// Remove a card from the cache
void card_cache_remove(const char* uid);

// Clear all cached cards
void card_cache_clear();

// Get cache stats
int card_cache_count();

// Get all unique media IDs across all cards (excluding podcasts)
// Returns count of IDs written to output array
// Caller must provide array of sufficient size (MAX_CACHED_CARDS * MAX_TRACKS_PER_CARD)
// Only returns IDs from song/playlist cards (cacheable content)
int card_cache_get_all_media_ids(int* outIds, int maxIds);

#endif
