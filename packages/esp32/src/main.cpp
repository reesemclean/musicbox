#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    delay(1000);  // Give serial time to initialize
    Serial.println("MusicBox ESP32 Starting...");

    // PSRAM verification
    if (psramFound()) {
        Serial.printf("PSRAM: %d bytes\n", ESP.getPsramSize());

        // Test allocation in PSRAM
        size_t testSize = 1024 * 1024;  // 1MB test
        uint8_t* testBuffer = (uint8_t*)ps_malloc(testSize);

        if (testBuffer) {
            // Write test pattern
            for (size_t i = 0; i < testSize; i++) {
                testBuffer[i] = (uint8_t)(i & 0xFF);
            }

            // Verify test pattern
            bool passed = true;
            for (size_t i = 0; i < testSize; i++) {
                if (testBuffer[i] != (uint8_t)(i & 0xFF)) {
                    passed = false;
                    break;
                }
            }

            free(testBuffer);
            Serial.printf("PSRAM test: %s\n", passed ? "PASSED" : "FAILED");
        } else {
            Serial.println("PSRAM test: FAILED (allocation failed)");
        }
    } else {
        Serial.println("PSRAM: Not found");
    }
}

void loop() {
    delay(1000);
}
