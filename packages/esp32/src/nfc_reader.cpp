#include "nfc_reader.h"
#include <Adafruit_PN532.h>

// I2C pins for PN532
#define PN532_SDA 8
#define PN532_SCL 9

// Debounce settings
#define DEBOUNCE_MS 1500

// Retry settings
#define NFC_INIT_RETRY_INTERVAL_MS 5000
#define NFC_READ_RETRY_MAX 3

// NFC reader instance
static Adafruit_PN532 nfc(PN532_SDA, PN532_SCL);

// State
static bool ready = false;
static bool enabled = false;
static uint8_t last_uid[7] = {0};
static uint8_t last_uid_len = 0;
static unsigned long last_scan_time = 0;

// Retry state
static unsigned long last_init_attempt = 0;
static int consecutive_read_errors = 0;

// Callback
static CardScannedCallback on_card_scanned_cb = nullptr;

bool nfc_init() {
    Serial.println("[NFC] Initializing PN532...");
    nfc.begin();

    uint32_t versiondata = nfc.getFirmwareVersion();
    if (!versiondata) {
        Serial.println("[NFC] PN532 not found - will retry in loop");
        ready = false;
        last_init_attempt = millis();
        return false;
    }

    Serial.printf("[NFC] Found PN532 firmware v%d.%d\n",
        (versiondata >> 16) & 0xFF,
        (versiondata >> 8) & 0xFF);

    nfc.SAMConfig();
    ready = true;
    consecutive_read_errors = 0;
    Serial.println("[NFC] Ready to read cards");
    return true;
}

// Retry initialization if it failed
static void nfc_retry_init() {
    if (ready) return;

    unsigned long now = millis();
    if (now - last_init_attempt < NFC_INIT_RETRY_INTERVAL_MS) return;

    last_init_attempt = now;
    Serial.println("[NFC] Retrying initialization...");

    nfc.begin();
    uint32_t versiondata = nfc.getFirmwareVersion();
    if (versiondata) {
        Serial.printf("[NFC] Found PN532 firmware v%d.%d\n",
            (versiondata >> 16) & 0xFF,
            (versiondata >> 8) & 0xFF);
        nfc.SAMConfig();
        ready = true;
        consecutive_read_errors = 0;
        Serial.println("[NFC] Ready to read cards (after retry)");
    }
}

void nfc_on_card_scanned(CardScannedCallback callback) {
    on_card_scanned_cb = callback;
}

void nfc_loop() {
    // Retry initialization if not ready
    if (!ready) {
        nfc_retry_init();
        return;
    }

    if (!enabled) return;

    uint8_t uid[7];
    uint8_t uid_len;

    // Non-blocking read attempt (50ms timeout - balance between detection and responsiveness)
    if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uid_len, 50)) {
        // Reset error counter on successful read
        consecutive_read_errors = 0;

        unsigned long now = millis();

        // Check if this is the same card we just scanned (debounce)
        bool same_card = (uid_len == last_uid_len) &&
                         (memcmp(uid, last_uid, uid_len) == 0);

        if (!same_card || (now - last_scan_time > DEBOUNCE_MS)) {
            // New card or debounce period passed
            memcpy(last_uid, uid, uid_len);
            last_uid_len = uid_len;
            last_scan_time = now;

            // Convert UID to hex string
            char uid_str[15];
            char* p = uid_str;
            for (int i = 0; i < uid_len; i++) {
                p += sprintf(p, "%02X", uid[i]);
            }

            Serial.printf("[NFC] Card scanned: %s\n", uid_str);

            // Invoke callback
            if (on_card_scanned_cb) {
                on_card_scanned_cb(uid_str);
            }
        }
    }
}

void nfc_set_enabled(bool value) {
    enabled = value;
    if (enabled) {
        Serial.println("[NFC] Scanning enabled");
    }
}

bool nfc_is_ready() {
    return ready;
}
