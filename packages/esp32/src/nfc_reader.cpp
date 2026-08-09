#include "nfc_reader.h"
#include "logger.h"
#include <Wire.h>
#include <Adafruit_PN532.h>

// I2C pins for PN532
#define PN532_SDA 8
#define PN532_SCL 9

// Debounce settings
#define DEBOUNCE_MS 1500

// How often to attempt a read. Every attempt costs I2C traffic and holds the
// scan task for the duration, so this is paced to how fast a card can actually
// be presented rather than run flat out.
#define NFC_SCAN_INTERVAL_MS 100

// A read attempt blocks for roughly twice this: the library waits this long
// for the command ACK and then again for the response. Generous on purpose —
// see the desync note in attempt_read().
#define NFC_READ_TIMEOUT_MS 100

// Retry settings
#define NFC_INIT_RETRY_INTERVAL_MS 5000

// Only 4- and 7-byte UIDs are expected from ISO14443A, and the buffers here
// are sized for those. Anything else means the frame was not a target report.
#define UID_LEN_SINGLE 4
#define UID_LEN_DOUBLE 7

// The library copies uidLength bytes out of its packet buffer without checking
// the value it read, so the destination has to cover the whole range that byte
// can hold. Sized for the library's behaviour, not for a real UID.
#define UID_BUF_SIZE 255

// Two hex characters per byte, plus a terminator.
#define UID_STR_SIZE (UID_LEN_DOUBLE * 2 + 1)

// The two-argument I2C constructor takes (irq, reset) — not pins. The bus
// itself comes from Wire.begin() below. Passing the pin numbers here made the
// library treat SCL as a reset line and drive it as a plain output.
static Adafruit_PN532 nfc(-1, -1);

// ─────────────────────────────────────────────────────────────────────────────
// Scan task
//
// Reads run here rather than on the loop task, because a read blocks for as
// long as it takes the reader to answer and the loop task has buttons to
// sample. Completed reads are queued and handed back on the loop task in
// nfc_loop(): the callback publishes over MQTT, which is only safe from there.
// ─────────────────────────────────────────────────────────────────────────────

typedef struct {
    char uid[UID_STR_SIZE];
} CardScan;

#define SCAN_QUEUE_SIZE 4

static QueueHandle_t scanQueue = NULL;
static TaskHandle_t nfcTaskHandle = NULL;

// State. Written on one task and read from the other, hence volatile.
static volatile bool ready = false;
static volatile bool enabled = false;

// Owned by the scan task.
static uint8_t last_uid[UID_LEN_DOUBLE] = {0};
static uint8_t last_uid_len = 0;
static unsigned long last_scan_time = 0;
static unsigned long last_desync_report = 0;
#define DESYNC_REPORT_INTERVAL_MS 5000

// Callback
static CardScannedCallback on_card_scanned_cb = nullptr;

/** Bring the reader up. Scan task only. */
static bool try_init() {
    nfc.begin();

    uint32_t versiondata = nfc.getFirmwareVersion();
    if (!versiondata) return false;

    LOG_I(MOD_NFC, "Found PN532 firmware v%d.%d",
        (int)((versiondata >> 16) & 0xFF),
        (int)((versiondata >> 8) & 0xFF));

    nfc.SAMConfig();
    return true;
}

/** One read attempt. Scan task only. */
static void attempt_read() {
    uint8_t uid[UID_BUF_SIZE];
    uint8_t uid_len;

    // On timeout the library gives up without cancelling the scan it started,
    // so the reader answers the abandoned command later — into whatever read
    // comes next. That leaves the two sides one frame apart, and what we then
    // parse is not the response we asked for. A generous window is what keeps
    // a present card's reply inside the call that asked for it; the guard
    // below is what makes a desync harmless when one happens anyway.
    if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uid_len,
                                 NFC_READ_TIMEOUT_MS)) {
        return;
    }

    // The library takes the length straight from the frame and copies that
    // many bytes without checking the value, so a desynced frame yields
    // whatever that byte happened to be. Treat anything that is not a real UID
    // length as one of those and drop it — passing it on would overrun
    // last_uid and uid_str below.
    if (uid_len != UID_LEN_SINGLE && uid_len != UID_LEN_DOUBLE) {
        if (millis() - last_desync_report > DESYNC_REPORT_INTERVAL_MS) {
            last_desync_report = millis();
            LOG_W(MOD_NFC, "Discarding frame with implausible UID length %u",
                  (unsigned)uid_len);
        }
        return;
    }

    unsigned long now = millis();

    // Check if this is the same card we just scanned (debounce)
    bool same_card = (uid_len == last_uid_len) &&
                     (memcmp(uid, last_uid, uid_len) == 0);
    if (same_card && now - last_scan_time <= DEBOUNCE_MS) return;

    memcpy(last_uid, uid, uid_len);
    last_uid_len = uid_len;
    last_scan_time = now;

    CardScan scan;
    char* p = scan.uid;
    for (int i = 0; i < uid_len; i++) {
        p += sprintf(p, "%02X", uid[i]);
    }

    // Dropped rather than waited on: blocking here would only delay the next
    // read, and a scan the loop task has not drained yet is already stale.
    if (xQueueSend(scanQueue, &scan, 0) != pdTRUE) {
        LOG_W(MOD_NFC, "Scan queue full, dropping read");
    }
}

static void nfcTask(void* parameter) {
    LOG_I(MOD_NFC, "Scan task started on core %d", xPortGetCoreID());

    // All I2C for the reader happens on this task, starting with the bus.
    Wire.begin(PN532_SDA, PN532_SCL);

    for (;;) {
        if (!ready) {
            if (try_init()) {
                ready = true;
                LOG_I(MOD_NFC, "Ready to read cards");
            } else {
                LOG_W(MOD_NFC, "PN532 not found, retrying");
                vTaskDelay(pdMS_TO_TICKS(NFC_INIT_RETRY_INTERVAL_MS));
            }
            continue;
        }

        if (enabled) attempt_read();

        vTaskDelay(pdMS_TO_TICKS(NFC_SCAN_INTERVAL_MS));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

bool nfc_init() {
    LOG_I(MOD_NFC, "Initializing PN532...");

    scanQueue = xQueueCreate(SCAN_QUEUE_SIZE, sizeof(CardScan));
    if (scanQueue == NULL) {
        LOG_E(MOD_NFC, "Failed to create scan queue");
        return false;
    }

    // Pinned away from core 0, which the audio task and the WiFi stack share.
    // Low priority: this task spends nearly all its time asleep, and nothing
    // it does is more urgent than either of those.
    xTaskCreatePinnedToCore(nfcTask, "NfcTask", 4096, NULL, 1, &nfcTaskHandle, 1);

    return true;
}

void nfc_on_card_scanned(CardScannedCallback callback) {
    on_card_scanned_cb = callback;
}

void nfc_loop() {
    if (scanQueue == NULL) return;

    // Non-blocking. The read itself already happened on the scan task; this is
    // only where its result gets handed to the callback.
    CardScan scan;
    while (xQueueReceive(scanQueue, &scan, 0) == pdTRUE) {
        Serial.printf("[NFC] Card scanned: %s\n", scan.uid);
        if (on_card_scanned_cb) on_card_scanned_cb(scan.uid);
    }
}

void nfc_set_enabled(bool value) {
    enabled = value;
    if (enabled) {
        LOG_I(MOD_NFC, "Scanning enabled");
    }
}

bool nfc_is_ready() {
    return ready;
}
