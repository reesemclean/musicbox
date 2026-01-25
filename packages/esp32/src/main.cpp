#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_PN532.h>

// I2C pins for PN532
#define I2C_SDA 8
#define I2C_SCL 9

#define DEBOUNCE_MS 2000

Adafruit_PN532 nfc(I2C_SDA, I2C_SCL);

// Debounce state
static uint8_t last_uid[7];
static uint8_t last_uid_len = 0;
static unsigned long last_read_time = 0;

static bool is_same_card(uint8_t *uid, uint8_t len) {
    if (len != last_uid_len) return false;
    for (int i = 0; i < len; i++) {
        if (uid[i] != last_uid[i]) return false;
    }
    return true;
}

static void save_card(uint8_t *uid, uint8_t len) {
    last_uid_len = len;
    for (int i = 0; i < len; i++) {
        last_uid[i] = uid[i];
    }
    last_read_time = millis();
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("MusicBox ESP32 Starting...");

    // PSRAM check
    if (psramFound()) {
        Serial.printf("PSRAM: %d bytes\n", ESP.getPsramSize());
    } else {
        Serial.println("PSRAM: Not found");
    }

    // Initialize PN532
    Serial.println("Initializing PN532...");
    nfc.begin();

    uint32_t versiondata = nfc.getFirmwareVersion();
    if (!versiondata) {
        Serial.println("PN532 not found - check wiring and I2C mode");
        return;
    }

    Serial.printf("Found PN532 - Firmware v%d.%d\n",
        (versiondata >> 8) & 0xFF,
        versiondata & 0xFF);

    // Configure for ISO14443A (NFC Type A cards)
    nfc.SAMConfig();
    Serial.println("Waiting for NFC card...");
}

void loop() {
    uint8_t uid[7];
    uint8_t uidLength;

    if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100)) {
        // Check debounce: ignore same card within window
        if (is_same_card(uid, uidLength) && (millis() - last_read_time < DEBOUNCE_MS)) {
            return;
        }

        // New card or debounce expired
        save_card(uid, uidLength);

        Serial.print("Card detected - UID: ");
        for (int i = 0; i < uidLength; i++) {
            Serial.printf("%02X", uid[i]);
        }
        Serial.println();
    }
}
