#ifndef NFC_READER_H
#define NFC_READER_H

#include <functional>

// Callback when a card is scanned (receives UID as hex string)
typedef std::function<void(const char* uid)> CardScannedCallback;

// Initialize the NFC reader
// Returns true if PN532 was found
bool nfc_init();

// Set callback for card scans. Runs on the loop task, from nfc_loop().
void nfc_on_card_scanned(CardScannedCallback callback);

// Runs on the scan task the instant a new UID is captured, before the read is
// handed to the loop task. Returns whether to accept the read: a rejected one
// is dropped outright, never handed over, so the one decision covers both the
// callback's own feedback and the scan.
typedef std::function<bool(const char* uid)> CardReadCallback;

// Set it. For feedback that mustn't wait on the loop task, which can stall
// behind the network — so keep it quick and safe from any task. Register
// before enabling scanning.
void nfc_on_card_read(CardReadCallback callback);

// Drop any reads waiting to be handed to the loop task.
void nfc_discard_pending();

// Call in loop to poll for cards
// Only processes cards when enabled
void nfc_loop();

// Enable/disable card scanning
void nfc_set_enabled(bool enabled);

// Check if NFC reader is ready
bool nfc_is_ready();

#endif
