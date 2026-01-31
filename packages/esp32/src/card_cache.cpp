#include "card_cache.h"
#include <string.h>

static CachedCard cache[MAX_CACHED_CARDS];
static int cache_count = 0;

void card_cache_init() {
    memset(cache, 0, sizeof(cache));
    cache_count = 0;
    Serial.println("[CardCache] Initialized");
}

CachedCard* card_cache_lookup(const char* uid) {
    for (int i = 0; i < MAX_CACHED_CARDS; i++) {
        if (cache[i].valid && strcmp(cache[i].uid, uid) == 0) {
            return &cache[i];
        }
    }
    return nullptr;
}

void card_cache_set(const char* uid, int* mediaIds, int trackCount, int volume) {
    // Find existing or empty slot
    int slot = -1;
    for (int i = 0; i < MAX_CACHED_CARDS; i++) {
        if (cache[i].valid && strcmp(cache[i].uid, uid) == 0) {
            slot = i;  // Update existing
            break;
        }
        if (!cache[i].valid && slot == -1) {
            slot = i;  // First empty slot
        }
    }

    if (slot == -1) {
        Serial.println("[CardCache] Cache full!");
        return;
    }

    // Store the card
    strncpy(cache[slot].uid, uid, sizeof(cache[slot].uid) - 1);
    cache[slot].trackCount = min(trackCount, MAX_TRACKS_PER_CARD);
    for (int i = 0; i < cache[slot].trackCount; i++) {
        cache[slot].mediaIds[i] = mediaIds[i];
    }
    cache[slot].volume = volume;

    if (!cache[slot].valid) {
        cache[slot].valid = true;
        cache_count++;
    }

    Serial.printf("[CardCache] Cached card %s (%d tracks)\n", uid, trackCount);
}

void card_cache_remove(const char* uid) {
    for (int i = 0; i < MAX_CACHED_CARDS; i++) {
        if (cache[i].valid && strcmp(cache[i].uid, uid) == 0) {
            cache[i].valid = false;
            cache_count--;
            Serial.printf("[CardCache] Removed card %s\n", uid);
            return;
        }
    }
}

void card_cache_clear() {
    for (int i = 0; i < MAX_CACHED_CARDS; i++) {
        cache[i].valid = false;
    }
    cache_count = 0;
    Serial.println("[CardCache] Cleared");
}

int card_cache_count() {
    return cache_count;
}
