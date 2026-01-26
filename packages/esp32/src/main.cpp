#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_PN532.h>
#include <Button2.h>
#include "Audio.h"
#include "secrets.h"

// Pin definitions
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

#define I2C_SDA 8
#define I2C_SCL 9

#define BTN_PLAY   10
#define BTN_VOL_UP 11
#define BTN_VOL_DN 12
#define BTN_NEXT   13
#define BTN_PREV   14

#define SD_CLK  38
#define SD_MOSI 39
#define SD_MISO 40
#define SD_CS   41

// Objects
Adafruit_PN532 nfc(I2C_SDA, I2C_SCL);
Audio audio;
Button2 btnPlay, btnVolUp, btnVolDn, btnNext, btnPrev;

// State
bool nfc_ok = false;

// Button handlers
void onPlayClick(Button2 &btn) {
    Serial.println("Play/Pause: click");
}

void onPlayLongPress(Button2 &btn) {
    Serial.println("Play/Pause: LONG PRESS");
}

void onVolUpClick(Button2 &btn) {
    Serial.println("Volume Up: click");
}

void onVolDnClick(Button2 &btn) {
    Serial.println("Volume Down: click");
}

void onNextClick(Button2 &btn) {
    Serial.println("Next: click");
}

void onPrevClick(Button2 &btn) {
    Serial.println("Prev: click");
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== COMPONENT TEST ==========\n");

    // PSRAM
    Serial.print("PSRAM: ");
    if (psramFound()) {
        Serial.printf("OK (%d bytes)\n", ESP.getPsramSize());
    } else {
        Serial.println("NOT FOUND");
    }

    // WiFi
    Serial.print("WiFi: ");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
        delay(500);
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("OK (IP: %s)\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("FAILED");
    }

    // SD Card
    Serial.print("SD Card: ");
    SPI.begin(SD_CLK, SD_MISO, SD_MOSI, SD_CS);
    if (SD.begin(SD_CS)) {
        Serial.printf("OK (%llu MB)\n", SD.cardSize() / (1024 * 1024));
    } else {
        Serial.println("NOT FOUND");
    }

    // NFC
    Serial.print("NFC: ");
    nfc.begin();
    uint32_t ver = nfc.getFirmwareVersion();
    if (ver) {
        nfc_ok = true;
        nfc.SAMConfig();
        Serial.printf("OK (v%d.%d)\n", (ver >> 8) & 0xFF, ver & 0xFF);
    } else {
        Serial.println("NOT FOUND");
    }

    // Audio
    Serial.print("Audio: ");
    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.setVolume(5);
    Serial.println("OK");

    // Buttons
    Serial.print("Buttons: ");
    btnPlay.begin(BTN_PLAY, INPUT_PULLUP, true);
    btnVolUp.begin(BTN_VOL_UP, INPUT_PULLUP, true);
    btnVolDn.begin(BTN_VOL_DN, INPUT_PULLUP, true);
    btnNext.begin(BTN_NEXT, INPUT_PULLUP, true);
    btnPrev.begin(BTN_PREV, INPUT_PULLUP, true);

    btnPlay.setClickHandler(onPlayClick);
    btnPlay.setLongClickTime(3000);
    btnPlay.setLongClickDetectedHandler(onPlayLongPress);
    btnVolUp.setClickHandler(onVolUpClick);
    btnVolDn.setClickHandler(onVolDnClick);
    btnNext.setClickHandler(onNextClick);
    btnPrev.setClickHandler(onPrevClick);
    Serial.println("OK");

    Serial.println("\n========== TEST COMPLETE ==========");
    Serial.println("Press buttons or tap NFC card\n");
}

void loop() {
    audio.loop();

    btnPlay.loop();
    btnVolUp.loop();
    btnVolDn.loop();
    btnNext.loop();
    btnPrev.loop();

    // NFC check (less frequent to not block buttons)
    static unsigned long lastNfc = 0;
    if (nfc_ok && millis() - lastNfc > 300) {
        lastNfc = millis();
        uint8_t uid[7];
        uint8_t uidLen;
        if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, 50)) {
            Serial.print("NFC Card: ");
            for (int i = 0; i < uidLen; i++) Serial.printf("%02X", uid[i]);
            Serial.println();
            delay(500);
        }
    }
}
