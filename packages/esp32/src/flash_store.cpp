#include "flash_store.h"
#include "device_config.h"
#include "logger.h"
#include <LittleFS.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Preferences.h>

// System sounds live at fixed paths and are fetched from matching server URLs.
#define PATH_STARTUP  "/startup.mp3"
#define PATH_READ_CUE "/read.mp3"
#define PATH_ERROR    "/error.mp3"

#define URL_STARTUP  "/api/sounds/startup.mp3"
#define URL_READ_CUE "/api/sounds/scan.mp3"
#define URL_ERROR    "/api/sounds/error.mp3"

#define PATH_SOUNDMACHINE "/soundmachine.mp3"
// Shared scratch path. Only one download runs at a time (flash_process does
// one unit of work per call), so a single temp file is enough.
#define PATH_DOWNLOAD_TMP "/download.tmp"

// Give up if no bytes arrive for this long. Bounds a hung connection without
// aborting a merely slow one — the sound machine file is a couple of MB.
#define DOWNLOAD_STALL_TIMEOUT_MS 15000

// A download can fail for reasons that pass: WiFi still settling after boot,
// the server mid-restart. Retry a few times, spaced out, then stop rather than
// hammering a server that is genuinely not going to answer.
#define DOWNLOAD_MAX_RETRIES  3
#define DOWNLOAD_RETRY_DELAY_MS 30000

// Slack left over the raw byte count when deciding whether a download fits.
// LittleFS rounds every file up to a block and spends a little more on
// metadata, so free bytes exactly equal to the file size is not enough room.
#define DOWNLOAD_SPACE_MARGIN 32768

// Sound machine configuration persists across reboots so a long-press works
// before — or without — any contact with the server.
#define NVS_NAMESPACE "musicbox"
#define NVS_SM_NAME   "sm_name"
#define NVS_SM_VOLUME "sm_volume"
#define NVS_SM_URL    "sm_url"

static bool mounted = false;

// Whether a sound machine file is on disk. Cached rather than probed, because
// the button handler asks from the loop task while the filesystem belongs to
// the audio task. Maintained by whoever writes or removes the file.
static volatile bool soundmachine_present = false;

// Pending work, set from any core and consumed by flash_process() on the audio
// task. Volatile because they are written and read from different cores.
static volatile bool want_system_sounds = false;
static int download_retries = 0;
static unsigned long retry_after_ms = 0;
static volatile bool want_soundmachine_download = false;
static volatile bool want_soundmachine_clear = false;

// Desired sound machine configuration. Guarded by configMutex because the
// strings are written from the MQTT task and read from the audio task.
static SemaphoreHandle_t configMutex = NULL;
static char sm_url[256] = {0};
static char sm_name[64] = {0};
static int sm_volume = -1;
// What is actually on disk — compared against sm_url to decide if the stored
// file is stale.
static char sm_stored_url[256] = {0};

static void load_soundmachine_config() {
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, true);
    String name = prefs.getString(NVS_SM_NAME, "");
    String url = prefs.getString(NVS_SM_URL, "");
    sm_volume = prefs.getInt(NVS_SM_VOLUME, -1);
    prefs.end();

    strncpy(sm_name, name.c_str(), sizeof(sm_name) - 1);
    strncpy(sm_stored_url, url.c_str(), sizeof(sm_stored_url) - 1);
    strncpy(sm_url, url.c_str(), sizeof(sm_url) - 1);

    soundmachine_present = LittleFS.exists(PATH_SOUNDMACHINE);

    // A recorded url with no file means an interrupted download. Fetch again.
    if (sm_stored_url[0] != '\0' && !soundmachine_present) {
        LOG_W(MOD_SYS, "Sound machine file missing, will re-download");
        want_soundmachine_download = true;
    }
}

static void save_soundmachine_config(const char* url, const char* name, int volume) {
    Preferences prefs;
    prefs.begin(NVS_NAMESPACE, false);
    prefs.putString(NVS_SM_URL, url ? url : "");
    prefs.putString(NVS_SM_NAME, name ? name : "");
    prefs.putInt(NVS_SM_VOLUME, volume);
    prefs.end();
}

bool flash_init() {
    // formatOnFail: a corrupt or never-initialised partition should come up
    // empty rather than leaving the device with no local sounds at all.
    if (!LittleFS.begin(true)) {
        LOG_E(MOD_SYS, "LittleFS mount failed");
        mounted = false;
        return false;
    }

    configMutex = xSemaphoreCreateMutex();
    if (configMutex == NULL) {
        LOG_E(MOD_SYS, "Failed to create flash config mutex");
        mounted = false;
        return false;
    }

    mounted = true;

    LOG_I(MOD_SYS, "LittleFS: %u KB used of %u KB",
          (unsigned)(LittleFS.usedBytes() / 1024),
          (unsigned)(LittleFS.totalBytes() / 1024));

    load_soundmachine_config();

    // Leftover from a download interrupted by a reset.
    if (LittleFS.exists(PATH_DOWNLOAD_TMP)) {
        LittleFS.remove(PATH_DOWNLOAD_TMP);
    }

    return true;
}

bool flash_available() {
    return mounted;
}

const char* flash_system_sound_path(SystemSound sound) {
    if (!mounted) return NULL;

    const char* path = NULL;
    switch (sound) {
        case SOUND_STARTUP:  path = PATH_STARTUP;  break;
        case SOUND_READ_CUE: path = PATH_READ_CUE; break;
        case SOUND_ERROR:    path = PATH_ERROR;    break;
    }

    if (!path || !LittleFS.exists(path)) return NULL;
    return path;
}

void flash_request_system_sounds() {
    want_system_sounds = true;
}

const char* flash_soundmachine_path() {
    if (!mounted || !soundmachine_present) return NULL;
    return PATH_SOUNDMACHINE;
}

int flash_soundmachine_volume() {
    return sm_volume;
}

void flash_set_soundmachine_config(const char* url, const char* name, int volume) {
    if (configMutex == NULL) return;
    if (xSemaphoreTake(configMutex, pdMS_TO_TICKS(100)) != pdTRUE) return;

    if (url == NULL || url[0] == '\0') {
        sm_url[0] = '\0';
        sm_name[0] = '\0';
        sm_volume = -1;
        want_soundmachine_clear = true;
        want_soundmachine_download = false;
    } else {
        bool url_changed = strcmp(sm_url, url) != 0;
        strncpy(sm_url, url, sizeof(sm_url) - 1);
        sm_url[sizeof(sm_url) - 1] = '\0';
        strncpy(sm_name, name ? name : "", sizeof(sm_name) - 1);
        sm_name[sizeof(sm_name) - 1] = '\0';
        sm_volume = volume;

        // Volume-only changes don't need a re-download.
        if (url_changed || strcmp(sm_stored_url, url) != 0) {
            want_soundmachine_download = true;
            download_retries = 0;
            retry_after_ms = 0;
        }
        want_soundmachine_clear = false;
    }

    xSemaphoreGive(configMutex);
}

static size_t fs_free_bytes() {
    size_t total = LittleFS.totalBytes();
    size_t used = LittleFS.usedBytes();
    return total > used ? total - used : 0;
}

/**
 * Called just before an existing destination file is deleted to make room.
 *
 * Lets the caller drop any cached "this file is present" state before it stops
 * being true. The window matters: freeing space up front means the destination
 * is missing for the length of the whole download, not just for the instant of
 * the rename at the end.
 */
typedef void (*FileGoneFn)(void);

/**
 * Stream an HTTP body to a file.
 *
 * Writes go to a temp path and are renamed on success, so an interrupted
 * download never leaves a truncated file looking complete. That costs room for
 * two copies at once, which the flash budget (spec §4.1) cannot always give:
 * a sound-machine file is ~2.4 MB in a 3.38 MB partition. So when the incoming
 * file won't fit alongside the one it replaces, the old one goes first — see
 * spec §3.8 for what that trade gives up.
 */
static bool download_to(const char* url, const char* finalPath, const char* tempPath,
                        FileGoneFn onFinalRemoved) {
    if (!WiFi.isConnected()) return false;

    HTTPClient http;
    http.begin(url);
    http.setTimeout(30000);

    int code = http.GET();
    if (code != HTTP_CODE_OK) {
        LOG_W(MOD_SYS, "Download failed (HTTP %d): %s", code, url);
        http.end();
        return false;
    }

    int contentLength = http.getSize();
    size_t freeBytes = fs_free_bytes();

    LOG_I(MOD_SYS, "Fetching %s: %d bytes, %u KB free",
          finalPath, contentLength, (unsigned)(freeBytes / 1024));

    // No Content-Length means no way to know whether it fits, so treat it as
    // "won't fit" rather than discovering it a megabyte into the write.
    bool fits_alongside = contentLength >= 0 &&
                          (size_t)contentLength + DOWNLOAD_SPACE_MARGIN <= freeBytes;

    if (!fits_alongside && LittleFS.exists(finalPath)) {
        LOG_W(MOD_SYS, "Freeing %s to make room for the new copy", finalPath);
        if (onFinalRemoved) onFinalRemoved();
        LittleFS.remove(finalPath);
        freeBytes = fs_free_bytes();
    }

    if (contentLength >= 0 && (size_t)contentLength + DOWNLOAD_SPACE_MARGIN > freeBytes) {
        LOG_E(MOD_SYS, "Not enough space for %s: need %d bytes, %u free",
              finalPath, contentLength, (unsigned)freeBytes);
        http.end();
        return false;
    }

    File out = LittleFS.open(tempPath, FILE_WRITE);
    if (!out) {
        LOG_E(MOD_SYS, "Cannot open %s for writing", tempPath);
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    uint8_t buf[1024];
    size_t written = 0;
    unsigned long lastProgress = millis();

    // Drain buffered data *before* honouring a closed connection: the server
    // finishes sending and closes while the last bytes are still sitting in the
    // socket buffer, so exiting on !connected() alone truncates the file. The
    // larger the file, the likelier that is — a few-KB response arrives in one
    // segment and never hits it, a multi-MB one reliably does.
    for (;;) {
        if (contentLength >= 0 && written >= (size_t)contentLength) break;

        size_t available = stream->available();

        if (available) {
            size_t toRead = available > sizeof(buf) ? sizeof(buf) : available;
            size_t got = stream->readBytes(buf, toRead);
            if (got > 0) {
                if (out.write(buf, got) != got) {
                    LOG_E(MOD_SYS, "Write failed after %u bytes, %u KB free: %s",
                          (unsigned)written, (unsigned)(fs_free_bytes() / 1024), finalPath);
                    out.close();
                    LittleFS.remove(tempPath);
                    http.end();
                    return false;
                }
                written += got;
                lastProgress = millis();
            }
            continue;  // keep draining while data is buffered
        }

        // Nothing buffered. Only now does a closed connection mean "done".
        if (!http.connected()) break;

        if (millis() - lastProgress > DOWNLOAD_STALL_TIMEOUT_MS) {
            LOG_W(MOD_SYS, "Download stalled after %u bytes", (unsigned)written);
            break;
        }

        vTaskDelay(1);  // yield while waiting for more
    }

    out.close();
    http.end();

    if (contentLength > 0 && written != (size_t)contentLength) {
        LOG_W(MOD_SYS, "Incomplete download (%u of %d bytes)", (unsigned)written, contentLength);
        LittleFS.remove(tempPath);
        return false;
    }

    LittleFS.remove(finalPath);
    if (!LittleFS.rename(tempPath, finalPath)) {
        LOG_E(MOD_SYS, "Rename failed: %s", finalPath);
        LittleFS.remove(tempPath);
        return false;
    }

    LOG_I(MOD_SYS, "Stored %s (%u bytes)", finalPath, (unsigned)written);
    return true;
}

static void download_system_sounds() {
    struct { const char* path; const char* url; } sounds[] = {
        { PATH_STARTUP,  URL_STARTUP  },
        { PATH_READ_CUE, URL_READ_CUE },
        { PATH_ERROR,    URL_ERROR    },
    };

    for (size_t i = 0; i < sizeof(sounds) / sizeof(sounds[0]); i++) {
        if (LittleFS.exists(sounds[i].path)) continue;

        char url[256];
        snprintf(url, sizeof(url), "%s%s", config_stream_base_url(), sounds[i].url);
        // No hook: these are only fetched when absent, so there is never an
        // existing copy for the space check to remove.
        download_to(url, sounds[i].path, PATH_DOWNLOAD_TMP, NULL);
    }
}

// The button handler reads soundmachine_present from the loop task, so it has
// to stop claiming the file exists before the file goes away. A long-press in
// the gap then lands on §3.8's "nothing configured" cue instead of handing the
// audio player a path to a deleted file.
static void soundmachine_file_gone() {
    soundmachine_present = false;
}

static bool download_soundmachine() {
    char url[256];
    // Couldn't read the config — treat as a transient failure so it retries.
    if (xSemaphoreTake(configMutex, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    strncpy(url, sm_url, sizeof(url) - 1);
    url[sizeof(url) - 1] = '\0';
    xSemaphoreGive(configMutex);

    if (url[0] == '\0') return true;  // nothing to fetch is not a failure

    LOG_I(MOD_SYS, "Downloading sound machine: %s", sm_name);

    if (!download_to(url, PATH_SOUNDMACHINE, PATH_DOWNLOAD_TMP, soundmachine_file_gone)) return false;

    soundmachine_present = true;
    strncpy(sm_stored_url, url, sizeof(sm_stored_url) - 1);
    sm_stored_url[sizeof(sm_stored_url) - 1] = '\0';
    save_soundmachine_config(sm_stored_url, sm_name, sm_volume);
    return true;
}

bool flash_has_pending_work() {
    return want_system_sounds || want_soundmachine_download ||
           want_soundmachine_clear || retry_after_ms > 0;
}

void flash_process() {
    if (!mounted) return;

    // One unit of work per call: each involves flash writes that stall the
    // cache, so the caller gets a chance to check for playback in between.
    if (want_system_sounds) {
        want_system_sounds = false;
        download_system_sounds();
        return;
    }

    if (want_soundmachine_clear) {
        want_soundmachine_clear = false;
        LittleFS.remove(PATH_SOUNDMACHINE);
        soundmachine_present = false;
        sm_stored_url[0] = '\0';
        save_soundmachine_config("", "", -1);
        LOG_I(MOD_SYS, "Sound machine cleared");
        return;
    }

    if (want_soundmachine_download) {
        // Clear first: a retry is scheduled explicitly below, so a permanent
        // failure (bad url, no space) can't spin.
        want_soundmachine_download = false;

        if (download_soundmachine()) {
            download_retries = 0;
            return;
        }

        // Without a retry, one dropped connection means no sound machine until
        // somebody changes the configuration again — the failure is invisible
        // until a long-press produces the error cue.
        if (download_retries < DOWNLOAD_MAX_RETRIES) {
            download_retries++;
            retry_after_ms = millis() + DOWNLOAD_RETRY_DELAY_MS;
            LOG_W(MOD_SYS, "Sound machine download failed, retry %d of %d",
                  download_retries, DOWNLOAD_MAX_RETRIES);
        } else {
            LOG_E(MOD_SYS, "Sound machine download failed after %d attempts",
                  DOWNLOAD_MAX_RETRIES);
            download_retries = 0;
        }
        return;
    }

    // A retry that has come due.
    if (retry_after_ms > 0 && millis() >= retry_after_ms) {
        retry_after_ms = 0;
        want_soundmachine_download = true;
    }
}
