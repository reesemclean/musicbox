#include "logger.h"
#include <stdarg.h>

// Circular buffer for logs on their way to the server.
// Holds output until the server takes it. Sized to survive a boot sequence
// plus the wait for WiFi and MQTT — the batch most worth keeping is the one
// produced before the device can send anything.
#define LOG_BUFFER_SIZE 4096
#define LOG_ENTRY_MAX 256

static char logBuffer[LOG_BUFFER_SIZE];
static int bufferHead = 0;
static int bufferTail = 0;
static SemaphoreHandle_t bufferMutex = NULL;

// Level prefixes
static const char* levelStr[] = {"D", "I", "W", "E"};

void logger_init() {
    bufferMutex = xSemaphoreCreateMutex();
    bufferHead = 0;
    bufferTail = 0;
}

static void buffer_add(const char* entry, int len) {
    // Buffer from the first line, not from whenever the network came up.
    // Boot is exactly when the interesting things happen — the filesystem
    // mounting, the restart reason, config loading — and all of that precedes
    // WiFi. Dropping it left the server with no record of a device's startup.
    // Sending is gated separately by the MQTT connection; the circular buffer
    // drops oldest-first if nothing ever drains it.
    if (bufferMutex == NULL) return;
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

/**
 * Copy pending output without consuming it.
 *
 * Separated from consuming so the caller can hold on to the lines until the
 * server has actually taken them — a publish that is rejected must not take
 * the only copy of a boot log with it.
 *
 * Stops on a line boundary where possible, so a batch never splits a line
 * across two publishes.
 */
int logger_peek_buffer(char* outBuf, int maxLen) {
    if (bufferMutex == NULL) return 0;
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) != pdTRUE) return 0;

    int count = 0;
    int lastNewline = -1;
    int pos = bufferTail;

    while (pos != bufferHead && count < maxLen - 1) {
        outBuf[count] = logBuffer[pos];
        if (outBuf[count] == '\n') lastNewline = count;
        count++;
        pos = (pos + 1) % LOG_BUFFER_SIZE;
    }

    // Truncate to the last complete line, unless a single line is longer than
    // the whole batch — then send what we have rather than nothing.
    if (pos != bufferHead && lastNewline >= 0) {
        count = lastNewline + 1;
    }

    outBuf[count] = '\0';

    xSemaphoreGive(bufferMutex);
    return count;
}

/** Drop the first `len` bytes, after they have been delivered. */
void logger_consume(int len) {
    if (bufferMutex == NULL || len <= 0) return;
    if (xSemaphoreTake(bufferMutex, pdMS_TO_TICKS(100)) != pdTRUE) return;

    for (int i = 0; i < len && bufferTail != bufferHead; i++) {
        bufferTail = (bufferTail + 1) % LOG_BUFFER_SIZE;
    }

    xSemaphoreGive(bufferMutex);
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

    // Buffer every level, not just problems.
    //
    // Restricting this to WARN and ERROR meant the server only ever heard
    // about failures, never about what the device was doing — no boot
    // sequence, no filesystem state, no playback events. Diagnosing anything
    // remotely required physical access to the serial port, which defeats the
    // point of shipping logs at all.
    //
    // Volume is not a concern: the buffer drops oldest-first, batches are
    // capped, and the control plane hides debug lines behind a toggle.
    char remoteBuf[LOG_ENTRY_MAX + 48];
    unsigned long uptime = millis() / 1000;
    int rlen = snprintf(remoteBuf, sizeof(remoteBuf), "%lu|%s|%s|%s",
        uptime, levelStr[level], module, msgBuf);
    buffer_add(remoteBuf, rlen);
}
