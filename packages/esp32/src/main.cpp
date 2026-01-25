#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    delay(1000);  // Give serial time to initialize
    Serial.println("MusicBox ESP32 Starting...");
}

void loop() {
    Serial.println("Hello World");
    delay(1000);
}
