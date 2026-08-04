#ifndef LOGGER_H
#define LOGGER_H

#include <Arduino.h>

// Log levels
enum LogLevel {
    LOG_LEVEL_DEBUG = 0,
    LOG_LEVEL_INFO = 1,
    LOG_LEVEL_WARN = 2,
    LOG_LEVEL_ERROR = 3,
    LOG_LEVEL_NONE = 4
};

// Minimum log level to output (compile-time filter)
#ifndef LOG_MIN_LEVEL
#define LOG_MIN_LEVEL LOG_LEVEL_DEBUG
#endif

// Module names (standardized)
#define MOD_AUDIO    "AUDIO"
#define MOD_NFC      "NFC"
#define MOD_WIFI     "WIFI"
#define MOD_MQTT     "MQTT"
#define MOD_SD       "SD"
#define MOD_OTA      "OTA"
#define MOD_CARD     "CARD"
#define MOD_SYS      "SYS"
#define MOD_BTN      "BTN"

// Initialize logger (call in setup)
void logger_init();


// Get buffered logs and clear buffer (returns count)
int logger_get_buffer(char* outBuf, int maxLen);

// Check if there are buffered logs waiting
bool logger_has_pending();

// Internal log function
void _log(LogLevel level, const char* module, const char* fmt, ...);

// Logging macros
#define LOG_D(mod, fmt, ...) do { if (LOG_LEVEL_DEBUG >= LOG_MIN_LEVEL) _log(LOG_LEVEL_DEBUG, mod, fmt, ##__VA_ARGS__); } while(0)
#define LOG_I(mod, fmt, ...) do { if (LOG_LEVEL_INFO >= LOG_MIN_LEVEL) _log(LOG_LEVEL_INFO, mod, fmt, ##__VA_ARGS__); } while(0)
#define LOG_W(mod, fmt, ...) do { if (LOG_LEVEL_WARN >= LOG_MIN_LEVEL) _log(LOG_LEVEL_WARN, mod, fmt, ##__VA_ARGS__); } while(0)
#define LOG_E(mod, fmt, ...) do { if (LOG_LEVEL_ERROR >= LOG_MIN_LEVEL) _log(LOG_LEVEL_ERROR, mod, fmt, ##__VA_ARGS__); } while(0)

#endif
