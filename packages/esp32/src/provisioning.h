#ifndef PROVISIONING_H
#define PROVISIONING_H

// Start the captive portal for WiFi + server URL provisioning.
// Blocks until credentials are saved or timeout (5 min) expires.
// Returns true if credentials were saved, false on timeout.
// On timeout the device restarts automatically.
bool provisioning_start();

#endif
