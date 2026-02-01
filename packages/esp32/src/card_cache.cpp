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

void card_cache_set(const char* uid, int* mediaIds, int trackCount, int volume, CardType type) {
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
    cache[slot].type = type;

    if (!cache[slot].valid) {
        cache[slot].valid = true;
        cache_count++;
    }

    const char* typeStr = (type == CARD_TYPE_PODCAST) ? "podcast" :
                          (type == CARD_TYPE_PLAYLIST) ? "playlist" : "song";
    Serial.printf("[CardCache] Cached card %s (%d tracks, %s)\n", uid, trackCount, typeStr);
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

int card_cache_get_all_media_ids(int* outIds, int maxIds) {
    // Collect all unique media IDs from cacheable cards (songs/playlists, not podcasts)
    int count = 0;

    for (int i = 0; i < MAX_CACHED_CARDS && count < maxIds; i++) {
        if (!cache[i].valid) continue;

        // Skip podcasts - they should be streamed, not cached
        if (cache[i].type == CARD_TYPE_PODCAST) continue;

        for (int j = 0; j < cache[i].trackCount && count < maxIds; j++) {
            int mediaId = cache[i].mediaIds[j];

            // Check if already in output (dedup)
            bool found = false;
            for (int k = 0; k < count; k++) {
                if (outIds[k] == mediaId) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                outIds[count++] = mediaId;
            }
        }
    }

    return count;
}
