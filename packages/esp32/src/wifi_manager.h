#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <functional>

// Callback types
typedef std::function<void()> WifiConnectedCallback;
typedef std::function<void()> WifiDisconnectedCallback;

// Initialize WiFi with callbacks
void wifi_init(WifiConnectedCallback on_connected, WifiDisconnectedCallback on_disconnected);

// Call in loop to handle reconnection
void wifi_loop();

// Check connection status
bool wifi_is_connected();

// Get IP address as string (empty if not connected)
const char* wifi_get_ip();

#endif
