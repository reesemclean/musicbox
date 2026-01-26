#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h"

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println("\n========== HTTP CLIENT TEST ==========\n");

    // Connect to WiFi
    Serial.print("WiFi: ");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
        delay(500);
    }
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("FAILED");
        return;
    }
    Serial.printf("OK (IP: %s)\n", WiFi.localIP().toString().c_str());

    // HTTP GET test
    Serial.print("HTTP GET: ");
    HTTPClient http;
    http.setTimeout(5000);
    http.begin("http://httpbin.org/ip");
    int httpCode = http.GET();

    if (httpCode > 0) {
        if (httpCode == HTTP_CODE_OK) {
            String payload = http.getString();
            payload.replace("\n", "");
            payload.replace("  ", "");
            Serial.printf("OK (%d) %s\n", httpCode, payload.c_str());
        } else {
            Serial.printf("OK (%d)\n", httpCode);
        }
    } else {
        Serial.printf("FAILED (%s)\n", http.errorToString(httpCode).c_str());
    }
    http.end();

    Serial.println("\n========== TEST COMPLETE ==========\n");
}

void loop() {
    delay(1000);
}
