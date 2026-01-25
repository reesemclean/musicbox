#include <Arduino.h>
#include <SPI.h>
#include <SD.h>

// SD Card SPI pins
#define SD_CLK  38
#define SD_MOSI 39
#define SD_MISO 40
#define SD_CS   41

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("MusicBox ESP32 Starting...");

    // Initialize SPI with custom pins
    SPI.begin(SD_CLK, SD_MISO, SD_MOSI, SD_CS);

    // Initialize SD card
    Serial.println("Initializing SD card...");
    if (!SD.begin(SD_CS)) {
        Serial.println("SD card mount failed!");
        return;
    }

    // Card info
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        Serial.println("No SD card attached");
        return;
    }

    Serial.print("SD Card Type: ");
    if (cardType == CARD_MMC) Serial.println("MMC");
    else if (cardType == CARD_SD) Serial.println("SDSC");
    else if (cardType == CARD_SDHC) Serial.println("SDHC");
    else Serial.println("UNKNOWN");

    uint64_t cardSize = SD.cardSize() / (1024 * 1024);
    uint64_t totalBytes = SD.totalBytes() / (1024 * 1024);
    uint64_t usedBytes = SD.usedBytes() / (1024 * 1024);

    Serial.printf("Card Size: %llu MB\n", cardSize);
    Serial.printf("Total Space: %llu MB\n", totalBytes);
    Serial.printf("Used Space: %llu MB\n", usedBytes);

    // List root directory
    Serial.println("\nRoot directory:");
    File root = SD.open("/");
    File file = root.openNextFile();
    while (file) {
        Serial.printf("  %s (%d bytes)\n", file.name(), file.size());
        file = root.openNextFile();
    }

    Serial.println("\nSD card ready!");

    // Read/write test
    Serial.println("\nRunning read/write test...");

    const char *testFile = "/test_rw.bin";
    const size_t testSize = 1024 * 1024;  // 1MB

    // Write test
    File f = SD.open(testFile, FILE_WRITE);
    if (!f) {
        Serial.println("Failed to open file for writing");
        return;
    }

    uint8_t buf[512];
    unsigned long startWrite = millis();
    for (size_t i = 0; i < testSize; i += sizeof(buf)) {
        for (size_t j = 0; j < sizeof(buf); j++) {
            buf[j] = (uint8_t)((i + j) & 0xFF);
        }
        f.write(buf, sizeof(buf));
    }
    f.close();
    unsigned long writeTime = millis() - startWrite;
    Serial.printf("Write: %d KB in %lu ms (%.1f KB/s)\n",
        testSize / 1024, writeTime, (float)testSize / writeTime);

    // Read and verify test
    f = SD.open(testFile, FILE_READ);
    if (!f) {
        Serial.println("Failed to open file for reading");
        return;
    }

    bool passed = true;
    unsigned long startRead = millis();
    for (size_t i = 0; i < testSize && passed; i += sizeof(buf)) {
        f.read(buf, sizeof(buf));
        for (size_t j = 0; j < sizeof(buf) && passed; j++) {
            if (buf[j] != (uint8_t)((i + j) & 0xFF)) {
                passed = false;
            }
        }
    }
    f.close();
    unsigned long readTime = millis() - startRead;
    Serial.printf("Read: %d KB in %lu ms (%.1f KB/s)\n",
        testSize / 1024, readTime, (float)testSize / readTime);

    // Cleanup
    SD.remove(testFile);

    Serial.printf("SD card test: %s\n", passed ? "PASSED" : "FAILED");
}

void loop() {
    delay(1000);
}
