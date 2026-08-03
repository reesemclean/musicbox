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
        }
        want_soundmachine_clear = false;
    }

    xSemaphoreGive(configMutex);
}

/**
 * Stream an HTTP body to a file.
 *
 * Writes go to a temp path and are renamed on success, so an interrupted
 * download never leaves a truncated file looking complete.
 */
static bool download_to(const char* url, const char* finalPath, const char* tempPath) {
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

    File out = LittleFS.open(tempPath, FILE_WRITE);
    if (!out) {
        LOG_E(MOD_SYS, "Cannot open %s for writing", tempPath);
        http.end();
        return false;
    }

    WiFiClient* stream = http.getStreamPtr();
    int contentLength = http.getSize();
    uint8_t buf[1024];
    size_t written = 0;

    while (http.connected() && (contentLength < 0 || written < (size_t)contentLength)) {
        size_t available = stream->available();
        if (available) {
            size_t toRead = available > sizeof(buf) ? sizeof(buf) : available;
            size_t got = stream->readBytes(buf, toRead);
            if (got == 0) break;
            if (out.write(buf, got) != got) {
                LOG_E(MOD_SYS, "Write failed (filesystem full?): %s", finalPath);
                out.close();
                LittleFS.remove(tempPath);
                http.end();
                return false;
            }
            written += got;
        }
        vTaskDelay(1);  // keep the watchdog fed on a slow link
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
        download_to(url, sounds[i].path, PATH_DOWNLOAD_TMP);
    }
}

static void download_soundmachine() {
    char url[256];
    if (xSemaphoreTake(configMutex, pdMS_TO_TICKS(100)) != pdTRUE) return;
    strncpy(url, sm_url, sizeof(url) - 1);
    url[sizeof(url) - 1] = '\0';
    xSemaphoreGive(configMutex);

    if (url[0] == '\0') return;

    LOG_I(MOD_SYS, "Downloading sound machine: %s", sm_name);

    if (download_to(url, PATH_SOUNDMACHINE, PATH_DOWNLOAD_TMP)) {
        soundmachine_present = true;
        strncpy(sm_stored_url, url, sizeof(sm_stored_url) - 1);
        sm_stored_url[sizeof(sm_stored_url) - 1] = '\0';
        save_soundmachine_config(sm_stored_url, sm_name, sm_volume);
    }
}

bool flash_has_pending_work() {
    return want_system_sounds || want_soundmachine_download || want_soundmachine_clear;
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
        want_soundmachine_download = false;
        download_soundmachine();
        return;
    }
}
