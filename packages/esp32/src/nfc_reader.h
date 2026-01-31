#ifndef NFC_READER_H
#define NFC_READER_H

#include <functional>

// Callback when a card is scanned (receives UID as hex string)
typedef std::function<void(const char* uid)> CardScannedCallback;

// Initialize the NFC reader
// Returns true if PN532 was found
bool nfc_init();

// Set callback for card scans
void nfc_on_card_scanned(CardScannedCallback callback);

// Call in loop to poll for cards
// Only processes cards when enabled
void nfc_loop();

// Enable/disable card scanning
void nfc_set_enabled(bool enabled);

// Check if NFC reader is ready
bool nfc_is_ready();

#endif
