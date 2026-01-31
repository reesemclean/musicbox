#include "nfc_reader.h"
#include <Adafruit_PN532.h>

// I2C pins for PN532
#define PN532_SDA 8
#define PN532_SCL 9

// Debounce settings
#define DEBOUNCE_MS 2000

// NFC reader instance
static Adafruit_PN532 nfc(PN532_SDA, PN532_SCL);

// State
static bool ready = false;
static bool enabled = false;
static uint8_t last_uid[7] = {0};
static uint8_t last_uid_len = 0;
static unsigned long last_scan_time = 0;

// Callback
static CardScannedCallback on_card_scanned_cb = nullptr;

bool nfc_init() {
    Serial.println("[NFC] Initializing PN532...");
    nfc.begin();

    uint32_t versiondata = nfc.getFirmwareVersion();
    if (!versiondata) {
        Serial.println("[NFC] PN532 not found - check wiring");
        ready = false;
        return false;
    }

    Serial.printf("[NFC] Found PN532 firmware v%d.%d\n",
        (versiondata >> 16) & 0xFF,
        (versiondata >> 8) & 0xFF);

    nfc.SAMConfig();
    ready = true;
    Serial.println("[NFC] Ready to read cards");
    return true;
}

void nfc_on_card_scanned(CardScannedCallback callback) {
    on_card_scanned_cb = callback;
}

void nfc_loop() {
    if (!ready || !enabled) return;

    uint8_t uid[7];
    uint8_t uid_len;

    // Non-blocking read attempt (100ms timeout)
    if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uid_len, 100)) {
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
