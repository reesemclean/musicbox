package triggers

import (
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"periph.io/x/conn/v3/gpio"
	"periph.io/x/conn/v3/gpio/gpioreg"
	"periph.io/x/conn/v3/i2c"
	"periph.io/x/conn/v3/i2c/i2creg"
	"periph.io/x/host/v3"
)

// PN532 I2C address and commands
const (
	pn532I2CAddress = 0x24

	pn532CommandGetFirmwareVersion  = 0x02
	pn532CommandSAMConfiguration    = 0x14
	pn532CommandRFConfiguration     = 0x32
	pn532CommandInListPassiveTarget = 0x4A

	pn532Preamble    = 0x00
	pn532StartCode1  = 0x00
	pn532StartCode2  = 0xFF
	pn532Postamble   = 0x00
	pn532HostToPN532 = 0xD4
	pn532ToHost      = 0xD5

	// IRQ GPIO pin (directly on Pi header)
	irqGPIO = 17

	nfcDebounceMs = 2000

	// Error handling constants
	nfcMinBackoff           = 1 * time.Second
	nfcMaxBackoff           = 30 * time.Second
	nfcErrorLogInterval     = 30 * time.Second // Only log errors every 30s
	nfcReinitThreshold      = 5                // Reinitialize after 5 consecutive errors
)

// NFCTrigger handles NFC card reading via PN532 I2C with IRQ-based detection
type NFCTrigger struct {
	mu           sync.Mutex
	i2cBusNumber int
	bus          i2c.BusCloser
	dev          i2c.Dev
	irqPin       gpio.PinIO
	player       PlayerController
	running      bool
	stopCh       chan struct{}
	lastCardID   string
	lastCardTime time.Time

	// Error tracking for resilience
	consecutiveErrors int
	lastErrorLog      time.Time
	backoffDuration   time.Duration
}

// NewNFCTrigger creates a new NFC trigger
func NewNFCTrigger(i2cBusNumber int) *NFCTrigger {
	return &NFCTrigger{
		i2cBusNumber: i2cBusNumber,
		stopCh:       make(chan struct{}),
	}
}

// Name returns the trigger name
func (n *NFCTrigger) Name() string {
	return "nfc"
}

// Start starts the NFC reader with IRQ-based card detection
func (n *NFCTrigger) Start(player PlayerController) error {
	n.player = player
	n.running = true

	slog.Debug("NFC Reader: Starting initialization", "i2cBus", n.i2cBusNumber)

	i2cPath := fmt.Sprintf("/dev/i2c-%d", n.i2cBusNumber)
	if _, err := os.Stat(i2cPath); os.IsNotExist(err) {
		slog.Warn("NFC Reader: I2C bus not found", "path", i2cPath)
		return nil // Non-fatal
	}
	slog.Debug("NFC Reader: I2C bus found", "path", i2cPath)

	// Initialize periph.io
	slog.Debug("NFC Reader: Initializing periph.io")
	if _, err := host.Init(); err != nil {
		slog.Warn("NFC Reader: Failed to initialize periph.io", "error", err)
		return nil // Non-fatal
	}

	// Open I2C bus
	busName := fmt.Sprintf("%d", n.i2cBusNumber)
	slog.Debug("NFC Reader: Opening I2C bus", "busName", busName)
	bus, err := i2creg.Open(busName)
	if err != nil {
		slog.Warn("NFC Reader: Failed to open I2C bus", "error", err)
		return nil // Non-fatal
	}
	n.bus = bus
	n.dev = i2c.Dev{Bus: bus, Addr: pn532I2CAddress}
	slog.Debug("NFC Reader: I2C device configured", "address", fmt.Sprintf("0x%02x", pn532I2CAddress))

	// Configure IRQ pin (required)
	slog.Debug("NFC Reader: Setting up IRQ pin", "gpio", irqGPIO)
	if !n.setupIRQPin() {
		slog.Error("NFC Reader: IRQ pin (GPIO17) not available - check wiring")
		slog.Error("Required: PN532 RQ pin → GPIO17 (Pin 11)")
		n.closeBus()
		return nil
	}

	// Wake up PN532
	slog.Debug("NFC Reader: Waking up PN532")
	n.wakeup()
	time.Sleep(50 * time.Millisecond)

	// Check firmware version
	slog.Debug("NFC Reader: Getting firmware version")
	firmware, err := n.getFirmwareVersion()
	if err != nil {
		slog.Warn("NFC Reader: Could not read firmware version", "error", err)
		slog.Warn("Check wiring: SDA→Pin3, SCL→Pin5, RQ→Pin11, VCC→5V, GND→GND")
		n.closeBus()
		return nil // Non-fatal
	}

	slog.Info("NFC Reader initialized",
		"ic", fmt.Sprintf("0x%x", firmware.IC),
		"version", fmt.Sprintf("%d.%d", firmware.Version, firmware.Revision))

	// Configure SAM with IRQ enabled
	slog.Debug("NFC Reader: Configuring SAM")
	if err := n.samConfig(); err != nil {
		slog.Warn("NFC Reader: SAM configuration failed", "error", err)
		n.closeBus()
		return nil // Non-fatal
	}

	// Configure for infinite retries (wait forever for card)
	slog.Debug("NFC Reader: Setting passive activation retries to infinite")
	if err := n.setPassiveActivationRetries(0xFF); err != nil {
		slog.Warn("NFC Reader: Failed to set activation retries", "error", err)
		// Continue anyway, will just use default timeout
	}

	slog.Info("NFC Reader: Using IRQ-based card detection (GPIO17)")
	go n.waitForCardLoop()

	return nil
}

// setupIRQPin configures the IRQ GPIO pin for edge detection
func (n *NFCTrigger) setupIRQPin() bool {
	pinName := fmt.Sprintf("GPIO%d", irqGPIO)
	pin := gpioreg.ByName(pinName)
	if pin == nil {
		slog.Debug("NFC Reader: IRQ GPIO pin not found", "pin", pinName)
		return false
	}

	// IRQ is active-low, so we watch for falling edge
	// Use PullUp since IRQ is open-drain on PN532
	if err := pin.In(gpio.PullUp, gpio.FallingEdge); err != nil {
		slog.Debug("NFC Reader: Failed to configure IRQ pin", "error", err)
		return false
	}

	n.irqPin = pin
	return true
}

// Stop stops the NFC trigger
func (n *NFCTrigger) Stop() error {
	n.mu.Lock()
	n.running = false
	n.mu.Unlock()

	close(n.stopCh)

	if n.irqPin != nil {
		_ = n.irqPin.Halt()
	}

	n.closeBus()

	slog.Info("NFC Reader stopped")
	return nil
}

func (n *NFCTrigger) closeBus() {
	if n.bus != nil {
		n.bus.Close()
		n.bus = nil
	}
}

func (n *NFCTrigger) wakeup() {
	// Send a dummy byte to wake up PN532
	_ = n.dev.Tx([]byte{0x00}, nil)
	time.Sleep(50 * time.Millisecond)
}

type firmwareInfo struct {
	IC       uint8
	Version  uint8
	Revision uint8
}

func (n *NFCTrigger) getFirmwareVersion() (*firmwareInfo, error) {
	resp, err := n.sendCommandPolling(pn532CommandGetFirmwareVersion, nil)
	if err != nil {
		return nil, err
	}
	if len(resp) < 3 {
		return nil, fmt.Errorf("invalid firmware response")
	}
	return &firmwareInfo{
		IC:       resp[0],
		Version:  resp[1],
		Revision: resp[2],
	}, nil
}

func (n *NFCTrigger) samConfig() error {
	_, err := n.sendCommandPolling(pn532CommandSAMConfiguration, []byte{
		0x01, // Normal mode
		0x14, // Timeout 50ms * 20 = 1s
		0x01, // Use IRQ pin
	})
	return err
}

// setPassiveActivationRetries configures how many times PN532 retries to activate a card
// 0xFF = infinite retries (wait forever)
func (n *NFCTrigger) setPassiveActivationRetries(maxRetries byte) error {
	_, err := n.sendCommandPolling(pn532CommandRFConfiguration, []byte{
		0x05,       // CfgItem: MaxRetries
		0xFF,       // MxRtyATR: max retries for ATR_REQ (default)
		0x01,       // MxRtyPSL: max retries for PSL_REQ (default)
		maxRetries, // MxRtyPassiveActivation: retries for InListPassiveTarget
	})
	return err
}

// waitForCardLoop uses IRQ-based detection - no polling!
func (n *NFCTrigger) waitForCardLoop() {
	slog.Debug("NFC Reader: Starting card detection loop")
	for {
		select {
		case <-n.stopCh:
			slog.Debug("NFC Reader: Card detection loop stopped")
			return
		default:
		}

		n.mu.Lock()
		if !n.running || n.bus == nil {
			n.mu.Unlock()
			slog.Debug("NFC Reader: Loop exiting - not running or bus closed")
			return
		}
		n.mu.Unlock()

		// Send InListPassiveTarget command and wait for card via IRQ
		cardID, err := n.waitForCard()
		if err != nil {
			n.handleError(err)
			continue
		}

		// Success - reset error tracking
		if n.consecutiveErrors > 0 {
			slog.Info("NFC Reader: Connection recovered after errors", "previousErrors", n.consecutiveErrors)
		}
		n.consecutiveErrors = 0
		n.backoffDuration = 0

		if cardID != "" {
			slog.Debug("NFC Reader: Card detected", "cardId", cardID)
			n.handleCardDetected(cardID)
		}
	}
}

// handleError implements backoff and reinitialization on errors
func (n *NFCTrigger) handleError(err error) {
	n.consecutiveErrors++

	// Log errors with throttling to avoid spam
	now := time.Now()
	if now.Sub(n.lastErrorLog) >= nfcErrorLogInterval {
		slog.Warn("NFC Reader: I2C errors occurring",
			"consecutiveErrors", n.consecutiveErrors,
			"lastError", err)
		n.lastErrorLog = now
	}

	// Try to reinitialize after threshold
	if n.consecutiveErrors >= nfcReinitThreshold {
		slog.Info("NFC Reader: Attempting reinitialization after consecutive errors",
			"errors", n.consecutiveErrors)
		n.tryReinitialize()
		n.consecutiveErrors = 0
	}

	// Apply backoff
	if n.backoffDuration == 0 {
		n.backoffDuration = nfcMinBackoff
	} else {
		n.backoffDuration *= 2
		if n.backoffDuration > nfcMaxBackoff {
			n.backoffDuration = nfcMaxBackoff
		}
	}

	// Wait with backoff, but check stopCh
	select {
	case <-n.stopCh:
		return
	case <-time.After(n.backoffDuration):
	}
}

// tryReinitialize attempts to close and reopen the I2C connection
func (n *NFCTrigger) tryReinitialize() {
	n.mu.Lock()
	defer n.mu.Unlock()

	// Close existing connection
	if n.bus != nil {
		n.bus.Close()
		n.bus = nil
	}

	// Wait a moment for hardware to settle
	time.Sleep(500 * time.Millisecond)

	// Try to reopen
	busName := fmt.Sprintf("%d", n.i2cBusNumber)
	bus, err := i2creg.Open(busName)
	if err != nil {
		slog.Warn("NFC Reader: Reinitialization failed - could not open I2C bus", "error", err)
		return
	}
	n.bus = bus
	n.dev = i2c.Dev{Bus: bus, Addr: pn532I2CAddress}

	// Wake up and reconfigure PN532
	n.wakeup()
	time.Sleep(50 * time.Millisecond)

	if _, err := n.getFirmwareVersion(); err != nil {
		slog.Warn("NFC Reader: Reinitialization failed - PN532 not responding", "error", err)
		n.bus.Close()
		n.bus = nil
		return
	}

	if err := n.samConfig(); err != nil {
		slog.Warn("NFC Reader: Reinitialization failed - SAM config error", "error", err)
		n.bus.Close()
		n.bus = nil
		return
	}

	_ = n.setPassiveActivationRetries(0xFF)

	slog.Info("NFC Reader: Successfully reinitialized")
}

// waitForCard sends InListPassiveTarget and waits for IRQ to signal card detection
func (n *NFCTrigger) waitForCard() (string, error) {
	if n.bus == nil {
		return "", fmt.Errorf("I2C bus not open")
	}

	// Build and send InListPassiveTarget command
	frame := n.buildFrame(pn532CommandInListPassiveTarget, []byte{
		0x01, // Max 1 card
		0x00, // 106 kbps type A (ISO14443A)
	})

	if err := n.dev.Tx(frame, nil); err != nil {
		return "", err
	}

	// Wait for ACK (first IRQ pulse)
	if !n.waitForIRQ(500 * time.Millisecond) {
		return "", fmt.Errorf("timeout waiting for ACK")
	}

	// Read and verify ACK
	ackBuf := make([]byte, 7)
	if err := n.dev.Tx(nil, ackBuf); err != nil {
		return "", err
	}

	// Now wait for response (card detected) - this can take a long time
	// Use longer timeout since we're waiting for a card to be presented
	// Check stopCh periodically
	for {
		select {
		case <-n.stopCh:
			return "", fmt.Errorf("stopped")
		default:
		}

		// Wait for IRQ with timeout so we can check stopCh
		if n.waitForIRQ(1 * time.Second) {
			break // IRQ fired - card detected or timeout
		}
	}

	// Read response
	respBuf := make([]byte, 32)
	if err := n.dev.Tx(nil, respBuf); err != nil {
		return "", err
	}

	resp, err := n.parseResponse(respBuf)
	if err != nil {
		return "", err
	}

	// Parse card UID from response
	return n.parseCardUID(resp), nil
}

// waitForIRQ waits for the IRQ pin to go low (active)
func (n *NFCTrigger) waitForIRQ(timeout time.Duration) bool {
	return n.irqPin.WaitForEdge(timeout)
}

// parseCardUID extracts the card UID from InListPassiveTarget response
func (n *NFCTrigger) parseCardUID(resp []byte) string {
	if len(resp) < 1 || resp[0] == 0 {
		return "" // No card found
	}

	// Response format:
	// [0] = number of targets
	// [1] = target number
	// [2,3] = SENS_RES
	// [4] = SEL_RES
	// [5] = NFCID length
	// [6...] = NFCID (UID)
	if len(resp) < 6 {
		return ""
	}

	uidLength := int(resp[5])
	if len(resp) < 6+uidLength {
		return ""
	}

	uid := resp[6 : 6+uidLength]
	cardID := ""
	for _, b := range uid {
		cardID += fmt.Sprintf("%02X", b)
	}

	return cardID
}

// handleCardDetected processes a detected card with debouncing
func (n *NFCTrigger) handleCardDetected(cardID string) {
	now := time.Now()

	n.mu.Lock()
	timeSinceLastScan := now.Sub(n.lastCardTime)
	if cardID != n.lastCardID || timeSinceLastScan >= nfcDebounceMs*time.Millisecond {
		n.lastCardID = cardID
		n.lastCardTime = now
		n.mu.Unlock()

		slog.Info("NFC Card detected", "cardId", cardID)
		if err := n.player.HandleCardScan(cardID); err != nil {
			slog.Error("Card scan failed", "error", err)
		}
	} else {
		n.mu.Unlock()
	}
}

// sendCommandPolling sends a command using polling for response (used during init)
func (n *NFCTrigger) sendCommandPolling(command byte, data []byte) ([]byte, error) {
	if n.bus == nil {
		return nil, fmt.Errorf("I2C bus not open")
	}

	slog.Debug("NFC Reader: Sending command (polling)", "command", fmt.Sprintf("0x%02x", command), "dataLen", len(data))

	// Build command frame
	frame := n.buildFrame(command, data)

	// Write command
	if err := n.dev.Tx(frame, nil); err != nil {
		slog.Debug("NFC Reader: Failed to write command", "error", err)
		return nil, err
	}

	// Wait for PN532 to process
	time.Sleep(50 * time.Millisecond)

	// Check if ready (read status byte)
	statusBuf := make([]byte, 1)
	ready := false
	for i := 0; i < 10; i++ {
		if err := n.dev.Tx(nil, statusBuf); err == nil && statusBuf[0] == 0x01 {
			ready = true
			slog.Debug("NFC Reader: PN532 ready after polls", "polls", i+1)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !ready {
		slog.Debug("NFC Reader: PN532 not ready after polling")
		return nil, fmt.Errorf("PN532 not ready")
	}

	// Read ACK frame
	ackBuf := make([]byte, 7)
	if err := n.dev.Tx(nil, ackBuf); err != nil {
		slog.Debug("NFC Reader: Failed to read ACK", "error", err)
		return nil, err
	}

	// Wait for response
	time.Sleep(50 * time.Millisecond)

	// Check ready for response
	ready = false
	for i := 0; i < 20; i++ {
		if err := n.dev.Tx(nil, statusBuf); err == nil && statusBuf[0] == 0x01 {
			ready = true
			slog.Debug("NFC Reader: Response ready after polls", "polls", i+1)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !ready {
		slog.Debug("NFC Reader: Response not ready after polling")
		return nil, fmt.Errorf("PN532 response not ready")
	}

	// Read response frame
	respBuf := make([]byte, 32)
	if err := n.dev.Tx(nil, respBuf); err != nil {
		slog.Debug("NFC Reader: Failed to read response", "error", err)
		return nil, err
	}

	slog.Debug("NFC Reader: Command response received", "data", fmt.Sprintf("%x", respBuf[:16]))
	return n.parseResponse(respBuf)
}

func (n *NFCTrigger) buildFrame(command byte, data []byte) []byte {
	length := byte(len(data) + 2) // TFI + command + data
	frame := []byte{
		pn532Preamble,
		pn532StartCode1,
		pn532StartCode2,
		length,
		(^length + 1) & 0xFF, // LCS (length checksum)
		pn532HostToPN532,     // TFI
		command,
	}
	frame = append(frame, data...)

	// Calculate DCS (data checksum)
	dcs := pn532HostToPN532 + command
	for _, b := range data {
		dcs += b
	}
	frame = append(frame, (^dcs+1)&0xFF, pn532Postamble)

	return frame
}

func (n *NFCTrigger) parseResponse(bytes []byte) ([]byte, error) {
	if len(bytes) < 8 {
		return nil, fmt.Errorf("response too short")
	}

	// Skip ready byte if present
	offset := 0
	if bytes[0] == 0x01 {
		offset = 1
	}

	// Check preamble and start codes
	if bytes[offset] != pn532Preamble ||
		bytes[offset+1] != pn532StartCode1 ||
		bytes[offset+2] != pn532StartCode2 {
		return nil, fmt.Errorf("invalid preamble")
	}

	dataLength := int(bytes[offset+3])
	if len(bytes) < offset+6+dataLength {
		return nil, fmt.Errorf("response too short for data")
	}

	tfi := bytes[offset+5]
	if tfi != pn532ToHost {
		return nil, fmt.Errorf("invalid TFI")
	}

	// Extract response data (skip TFI and command response byte)
	if dataLength < 2 {
		return nil, fmt.Errorf("data too short")
	}

	responseData := make([]byte, dataLength-2)
	copy(responseData, bytes[offset+7:offset+7+dataLength-2])

	return responseData, nil
}
