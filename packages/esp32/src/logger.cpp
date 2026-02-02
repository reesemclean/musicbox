#include "logger.h"
#include <stdarg.h>

// Circular buffer for remote logs (WARN and ERROR only)
#define LOG_BUFFER_SIZE 2048
#define LOG_ENTRY_MAX 256

static char logBuffer[LOG_BUFFER_SIZE];
static int bufferHead = 0;
static int bufferTail = 0;
static bool remoteEnabled = false;
static SemaphoreHandle_t bufferMutex = NULL;

// Level prefixes
static const char* levelStr[] = {"D", "I", "W", "E"};

void logger_init() {
    bufferMutex = xSemaphoreCreateMutex();
    bufferHead = 0;
    bufferTail = 0;
    remoteEnabled = false;
}

void logger_set_remote(bool enabled) {
    remoteEnabled = enabled;
}

static void buffer_add(const char* entry, int len) {
    if (!remoteEnabled || bufferMutex == NULL) return;
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(10)) != pdTRUE) return;

    // Add to circular buffer
    for (int i = 0; i < len && entry[i] != '\0'; i++) {
        logBuffer[bufferHead] = entry[i];
        bufferHead = (bufferHead + 1) % LOG_BUFFER_SIZE;

        // If we catch up to tail, advance tail (drop oldest)
        if (bufferHead == bufferTail) {
            bufferTail = (bufferTail + 1) % LOG_BUFFER_SIZE;
        }
    }

    // Add newline separator
    logBuffer[bufferHead] = '\n';
    bufferHead = (bufferHead + 1) % LOG_BUFFER_SIZE;
    if (bufferHead == bufferTail) {
        bufferTail = (bufferTail + 1) % LOG_BUFFER_SIZE;
    }

    xSemaphoreGive(bufferMutex);
}

bool logger_has_pending() {
    return bufferHead != bufferTail;
}

int logger_get_buffer(char* outBuf, int maxLen) {
    if (bufferMutex == NULL) return 0;
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) != pdTRUE) return 0;

    int count = 0;
    while (bufferTail != bufferHead && count < maxLen - 1) {
        outBuf[count++] = logBuffer[bufferTail];
        bufferTail = (bufferTail + 1) % LOG_BUFFER_SIZE;
    }
    outBuf[count] = '\0';

    xSemaphoreGive(bufferMutex);
    return count;
}

void _log(LogLevel level, const char* module, const char* fmt, ...) {
    char msgBuf[LOG_ENTRY_MAX];
    char fullBuf[LOG_ENTRY_MAX + 32];

    // Format the message
    va_list args;
    va_start(args, fmt);
    vsnprintf(msgBuf, sizeof(msgBuf), fmt, args);
    va_end(args);

    // Build full log line: [L][MOD] message
    int len = snprintf(fullBuf, sizeof(fullBuf), "[%s][%s] %s",
        levelStr[level], module, msgBuf);

    // Print to serial
    Serial.println(fullBuf);

    // Buffer WARN and ERROR for remote
    if (level >= LOG_LEVEL_WARN) {
        // Add uptime prefix for remote logs
        char remoteBuf[LOG_ENTRY_MAX + 48];
        unsigned long uptime = millis() / 1000;
        int rlen = snprintf(remoteBuf, sizeof(remoteBuf), "%lu|%s|%s|%s",
            uptime, levelStr[level], module, msgBuf);
        buffer_add(remoteBuf, rlen);
    }
}
