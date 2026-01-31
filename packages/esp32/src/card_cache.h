#ifndef CARD_CACHE_H
#define CARD_CACHE_H

#include <Arduino.h>

#define MAX_CACHED_CARDS 100
#define MAX_TRACKS_PER_CARD 50

struct CachedCard {
    char uid[15];           // NFC UID hex string
    int mediaIds[MAX_TRACKS_PER_CARD];
    int trackCount;
    int volume;             // -1 = use current volume
    bool valid;
};

// Initialize the cache
void card_cache_init();

// Look up a card by UID, returns null if not found
CachedCard* card_cache_lookup(const char* uid);

// Add or update a card in the cache
void card_cache_set(const char* uid, int* mediaIds, int trackCount, int volume);

// Remove a card from the cache
void card_cache_remove(const char* uid);

// Clear all cached cards
void card_cache_clear();

// Get cache stats
int card_cache_count();

#endif
