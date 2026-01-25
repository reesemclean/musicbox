#include <Arduino.h>
#include <SPIFFS.h>
#include "Audio.h"

// I2S pins for MAX98357A
#define I2S_BCLK 4
#define I2S_LRC  5
#define I2S_DOUT 6

Audio audio;

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

    // Initialize SPIFFS
    if (!SPIFFS.begin(true)) {
        Serial.println("SPIFFS mount failed");
        return;
    }
    Serial.println("SPIFFS mounted");

    // List files
    File root = SPIFFS.open("/");
    File file = root.openNextFile();
    while (file) {
        Serial.printf("  %s (%d bytes)\n", file.name(), file.size());
        file = root.openNextFile();
    }

    // Initialize audio
    audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
    audio.setVolume(5);  // 0-21

    // Play MP3 from SPIFFS
    if (SPIFFS.exists("/test.mp3")) {
        Serial.println("Playing /test.mp3...");
        audio.connecttoFS(SPIFFS, "/test.mp3");
    } else {
        Serial.println("File /test.mp3 not found!");
    }
}

void loop() {
    audio.loop();
}
