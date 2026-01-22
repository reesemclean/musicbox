// Hardware test utility for MusicBox
// Run this to verify button, NFC, and speaker wiring is working correctly.
//
// Usage: go run ./cmd/hwtest
// Or build: go build -o hwtest ./cmd/hwtest && ./hwtest

package main

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"periph.io/x/conn/v3/gpio"
	"periph.io/x/conn/v3/gpio/gpioreg"
	"periph.io/x/conn/v3/i2c"
	"periph.io/x/conn/v3/i2c/i2creg"
	"periph.io/x/host/v3"
)

// GPIO pin assignments (BCM numbering)
const (
	// Buttons
	pinPlayPause = 5
	pinVolumeUp  = 6
	pinVolumeDown = 13
	pinNextTrack = 16
	pinPrevTrack = 26

	// NFC
	pinNFCIRQ     = 17
	nfcI2CAddress = 0x24
	nfcI2CBus     = 1
)

// PN532 protocol constants
const (
	pn532Preamble        = 0x00
	pn532StartCode1      = 0x00
	pn532StartCode2      = 0xFF
	pn532Postamble       = 0x00
	pn532HostToPN532     = 0xD4
	pn532ToHost          = 0xD5
	pn532CmdGetFirmware  = 0x02
	pn532CmdSAMConfig    = 0x14
	pn532CmdRFConfig     = 0x32
	pn532CmdInListTarget = 0x4A
)

var buttonNames = map[int]string{
	pinPlayPause:  "Play/Pause",
	pinVolumeUp:   "Volume Up",
	pinVolumeDown: "Volume Down",
	pinNextTrack:  "Next Track",
	pinPrevTrack:  "Previous Track",
}

func main() {
	fmt.Println("===========================================")
	fmt.Println("  MusicBox Hardware Test Utility")
	fmt.Println("===========================================")
	fmt.Println()

	// Initialize periph.io
	if _, err := host.Init(); err != nil {
		fmt.Printf("ERROR: Failed to initialize GPIO library: %v\n", err)
		fmt.Println("Make sure you're running on a Raspberry Pi with GPIO access.")
		os.Exit(1)
	}
	fmt.Println("GPIO library initialized successfully.")
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)

	for {
		printMenu()
		choice := readChoice(reader)

		switch choice {
		case "1":
			testButtons()
		case "2":
			testNFC()
		case "3":
			testSpeaker()
		case "4":
			testAll()
		case "q", "Q":
			fmt.Println("\nGoodbye!")
			return
		default:
			fmt.Println("\nInvalid choice. Please try again.")
		}
		fmt.Println()
	}
}

func printMenu() {
	fmt.Println("Select a test to run:")
	fmt.Println("  1) Test Buttons (GPIO 5, 6, 13, 16, 26)")
	fmt.Println("  2) Test NFC Reader (PN532 on I2C)")
	fmt.Println("  3) Test Speaker (I2S audio)")
	fmt.Println("  4) Test All Hardware")
	fmt.Println("  q) Quit")
	fmt.Print("\nChoice: ")
}

func readChoice(reader *bufio.Reader) string {
	text, _ := reader.ReadString('\n')
	return strings.TrimSpace(text)
}

// =============================================================================
// Button Test
// =============================================================================

func testButtons() {
	fmt.Println("\n--- Button Test ---")
	fmt.Println("Press Ctrl+C to stop.")
	fmt.Println()

	pins := []int{pinPlayPause, pinVolumeUp, pinVolumeDown, pinNextTrack, pinPrevTrack}
	gpioPins := make([]gpio.PinIO, 0, len(pins))

	// Configure all button pins
	for _, pinNum := range pins {
		pinName := fmt.Sprintf("GPIO%d", pinNum)
		pin := gpioreg.ByName(pinName)
		if pin == nil {
			fmt.Printf("WARNING: GPIO%d (%s) not found\n", pinNum, buttonNames[pinNum])
			continue
		}

		if err := pin.In(gpio.PullUp, gpio.FallingEdge); err != nil {
			fmt.Printf("WARNING: Could not configure GPIO%d: %v\n", pinNum, err)
			continue
		}

		gpioPins = append(gpioPins, pin)
		fmt.Printf("OK: GPIO%d (%s) configured\n", pinNum, buttonNames[pinNum])
	}

	if len(gpioPins) == 0 {
		fmt.Println("\nERROR: No buttons could be configured.")
		return
	}

	fmt.Println()
	fmt.Println("Waiting for button presses...")
	fmt.Println("Expected wiring: Each button connects GPIO pin to GND (Pin 14)")
	fmt.Println()

	// Setup signal handler for clean exit
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	stopCh := make(chan struct{})

	// Start monitoring each pin in a goroutine
	for _, pin := range gpioPins {
		go monitorButton(pin, stopCh)
	}

	// Wait for Ctrl+C
	<-sigCh
	close(stopCh)
	signal.Stop(sigCh)

	// Cleanup
	for _, pin := range gpioPins {
		_ = pin.Halt()
	}

	fmt.Println("\nButton test stopped.")
}

func monitorButton(pin gpio.PinIO, stopCh chan struct{}) {
	pinNum := extractPinNum(pin.Name())
	lastPress := time.Time{}

	for {
		select {
		case <-stopCh:
			return
		default:
		}

		if pin.WaitForEdge(500 * time.Millisecond) {
			now := time.Now()
			// Simple debounce
			if now.Sub(lastPress) > 200*time.Millisecond {
				lastPress = now
				fmt.Printf("PRESSED: GPIO%d (%s) at %s\n",
					pinNum, buttonNames[pinNum], now.Format("15:04:05"))
			}
		}
	}
}

func extractPinNum(name string) int {
	var num int
	fmt.Sscanf(name, "GPIO%d", &num)
	return num
}

// =============================================================================
// NFC Test
// =============================================================================

func testNFC() {
	fmt.Println("\n--- NFC Reader Test ---")
	fmt.Println()

	// Check I2C bus exists
	i2cPath := fmt.Sprintf("/dev/i2c-%d", nfcI2CBus)
	if _, err := os.Stat(i2cPath); os.IsNotExist(err) {
		fmt.Printf("ERROR: I2C bus not found at %s\n", i2cPath)
		fmt.Println("Make sure I2C is enabled in raspi-config or via config.txt.")
		return
	}
	fmt.Printf("OK: I2C bus found at %s\n", i2cPath)

	// Open I2C bus
	bus, err := i2creg.Open(fmt.Sprintf("%d", nfcI2CBus))
	if err != nil {
		fmt.Printf("ERROR: Could not open I2C bus: %v\n", err)
		return
	}
	defer bus.Close()
	fmt.Println("OK: I2C bus opened")

	dev := &i2c.Dev{Bus: bus, Addr: nfcI2CAddress}

	// Wake up PN532
	_ = dev.Tx([]byte{0x00}, nil)
	time.Sleep(50 * time.Millisecond)

	// Get firmware version
	firmware, err := nfcGetFirmware(dev)
	if err != nil {
		fmt.Printf("ERROR: Could not communicate with PN532: %v\n", err)
		fmt.Println()
		fmt.Println("Troubleshooting:")
		fmt.Println("  - Check wiring: SDA→Pin3, SCL→Pin5, VCC→5V, GND→GND")
		fmt.Println("  - Verify PN532 is in I2C mode (check DIP switches)")
		fmt.Println("  - Run 'i2cdetect -y 1' to scan for devices (should show 0x24)")
		return
	}

	fmt.Printf("OK: PN532 detected! IC=0x%02X Version=%d.%d\n",
		firmware.ic, firmware.version, firmware.revision)

	// Configure SAM
	if err := nfcConfigSAM(dev); err != nil {
		fmt.Printf("ERROR: SAM configuration failed: %v\n", err)
		return
	}
	fmt.Println("OK: SAM configured")

	// Check IRQ pin
	irqPinName := fmt.Sprintf("GPIO%d", pinNFCIRQ)
	irqPin := gpioreg.ByName(irqPinName)
	if irqPin == nil {
		fmt.Printf("WARNING: IRQ pin (GPIO%d) not available\n", pinNFCIRQ)
	} else if err := irqPin.In(gpio.PullUp, gpio.FallingEdge); err != nil {
		fmt.Printf("WARNING: Could not configure IRQ pin: %v\n", err)
	} else {
		fmt.Printf("OK: IRQ pin (GPIO%d) configured\n", pinNFCIRQ)
	}

	fmt.Println()
	fmt.Println("NFC reader is ready! Present a card to test...")
	fmt.Println("Press Ctrl+C to stop.")
	fmt.Println()

	// Setup signal handler
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	// Set infinite retries for card detection
	_ = nfcSetRetries(dev)

	lastCardID := ""
	lastCardTime := time.Time{}

	for {
		select {
		case <-sigCh:
			signal.Stop(sigCh)
			if irqPin != nil {
				_ = irqPin.Halt()
			}
			fmt.Println("\nNFC test stopped.")
			return
		default:
		}

		cardID, err := nfcReadCard(dev, irqPin)
		if err != nil {
			// Timeout or no card, continue
			continue
		}

		if cardID != "" {
			now := time.Now()
			// Debounce same card
			if cardID != lastCardID || now.Sub(lastCardTime) > 2*time.Second {
				lastCardID = cardID
				lastCardTime = now
				fmt.Printf("CARD DETECTED: %s at %s\n", cardID, now.Format("15:04:05"))
			}
		}
	}
}

type firmwareInfo struct {
	ic       uint8
	version  uint8
	revision uint8
}

func nfcGetFirmware(dev *i2c.Dev) (*firmwareInfo, error) {
	resp, err := nfcSendCommand(dev, pn532CmdGetFirmware, nil)
	if err != nil {
		return nil, err
	}
	if len(resp) < 3 {
		return nil, fmt.Errorf("invalid firmware response")
	}
	return &firmwareInfo{
		ic:       resp[0],
		version:  resp[1],
		revision: resp[2],
	}, nil
}

func nfcConfigSAM(dev *i2c.Dev) error {
	_, err := nfcSendCommand(dev, pn532CmdSAMConfig, []byte{0x01, 0x14, 0x01})
	return err
}

func nfcSetRetries(dev *i2c.Dev) error {
	_, err := nfcSendCommand(dev, pn532CmdRFConfig, []byte{0x05, 0xFF, 0x01, 0xFF})
	return err
}

func nfcReadCard(dev *i2c.Dev, irqPin gpio.PinIO) (string, error) {
	// Build InListPassiveTarget command
	frame := nfcBuildFrame(pn532CmdInListTarget, []byte{0x01, 0x00})

	if err := dev.Tx(frame, nil); err != nil {
		return "", err
	}

	// Wait for ACK
	if irqPin != nil {
		if !irqPin.WaitForEdge(500 * time.Millisecond) {
			return "", fmt.Errorf("timeout waiting for ACK")
		}
	} else {
		time.Sleep(100 * time.Millisecond)
	}

	// Read ACK
	ackBuf := make([]byte, 7)
	if err := dev.Tx(nil, ackBuf); err != nil {
		return "", err
	}

	// Wait for response (card detection) - shorter timeout for interactive use
	if irqPin != nil {
		if !irqPin.WaitForEdge(1 * time.Second) {
			return "", nil // No card, will retry
		}
	} else {
		time.Sleep(500 * time.Millisecond)
	}

	// Read response
	respBuf := make([]byte, 32)
	if err := dev.Tx(nil, respBuf); err != nil {
		return "", err
	}

	resp, err := nfcParseResponse(respBuf)
	if err != nil {
		return "", err
	}

	return nfcParseCardUID(resp), nil
}

func nfcSendCommand(dev *i2c.Dev, cmd byte, data []byte) ([]byte, error) {
	frame := nfcBuildFrame(cmd, data)

	if err := dev.Tx(frame, nil); err != nil {
		return nil, err
	}

	time.Sleep(50 * time.Millisecond)

	// Poll for ready
	statusBuf := make([]byte, 1)
	ready := false
	for i := 0; i < 10; i++ {
		if err := dev.Tx(nil, statusBuf); err == nil && statusBuf[0] == 0x01 {
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !ready {
		return nil, fmt.Errorf("PN532 not ready")
	}

	// Read ACK
	ackBuf := make([]byte, 7)
	if err := dev.Tx(nil, ackBuf); err != nil {
		return nil, err
	}

	time.Sleep(50 * time.Millisecond)

	// Poll for response
	ready = false
	for i := 0; i < 20; i++ {
		if err := dev.Tx(nil, statusBuf); err == nil && statusBuf[0] == 0x01 {
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if !ready {
		return nil, fmt.Errorf("response not ready")
	}

	// Read response
	respBuf := make([]byte, 32)
	if err := dev.Tx(nil, respBuf); err != nil {
		return nil, err
	}

	return nfcParseResponse(respBuf)
}

func nfcBuildFrame(cmd byte, data []byte) []byte {
	length := byte(len(data) + 2)
	frame := []byte{
		pn532Preamble,
		pn532StartCode1,
		pn532StartCode2,
		length,
		(^length + 1) & 0xFF,
		pn532HostToPN532,
		cmd,
	}
	frame = append(frame, data...)

	dcs := pn532HostToPN532 + cmd
	for _, b := range data {
		dcs += b
	}
	frame = append(frame, (^dcs+1)&0xFF, pn532Postamble)

	return frame
}

func nfcParseResponse(bytes []byte) ([]byte, error) {
	if len(bytes) < 8 {
		return nil, fmt.Errorf("response too short")
	}

	offset := 0
	if bytes[0] == 0x01 {
		offset = 1
	}

	if bytes[offset] != pn532Preamble ||
		bytes[offset+1] != pn532StartCode1 ||
		bytes[offset+2] != pn532StartCode2 {
		return nil, fmt.Errorf("invalid preamble")
	}

	dataLength := int(bytes[offset+3])
	if len(bytes) < offset+6+dataLength {
		return nil, fmt.Errorf("response too short for data")
	}

	if bytes[offset+5] != pn532ToHost {
		return nil, fmt.Errorf("invalid TFI")
	}

	if dataLength < 2 {
		return nil, fmt.Errorf("data too short")
	}

	responseData := make([]byte, dataLength-2)
	copy(responseData, bytes[offset+7:offset+7+dataLength-2])

	return responseData, nil
}

func nfcParseCardUID(resp []byte) string {
	if len(resp) < 1 || resp[0] == 0 {
		return ""
	}

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

// =============================================================================
// Speaker Test
// =============================================================================

func testSpeaker() {
	fmt.Println("\n--- Speaker Test ---")
	fmt.Println()

	// Check if aplay is available
	if _, err := exec.LookPath("aplay"); err != nil {
		fmt.Println("ERROR: 'aplay' command not found.")
		fmt.Println("Make sure ALSA utilities are installed.")
		return
	}
	fmt.Println("OK: aplay found")

	// List audio devices
	fmt.Println("\nAudio devices:")
	cmd := exec.Command("aplay", "-l")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	_ = cmd.Run()
	fmt.Println()

	reader := bufio.NewReader(os.Stdin)

	fmt.Println("Speaker tests available:")
	fmt.Println("  1) Play 440Hz test tone (1 second)")
	fmt.Println("  2) Play ascending scale")
	fmt.Println("  3) Play system speaker-test")
	fmt.Println("  4) Play all tests")
	fmt.Println("  b) Back to main menu")
	fmt.Print("\nChoice: ")

	choice := readChoice(reader)

	switch choice {
	case "1":
		playTestTone(440, 1000)
	case "2":
		playScale()
	case "3":
		playSpeakerTest()
	case "4":
		fmt.Println("\nPlaying 440Hz tone...")
		playTestTone(440, 1000)
		time.Sleep(500 * time.Millisecond)
		fmt.Println("\nPlaying scale...")
		playScale()
		time.Sleep(500 * time.Millisecond)
		fmt.Println("\nPlaying speaker-test...")
		playSpeakerTest()
	case "b", "B":
		return
	default:
		fmt.Println("Invalid choice.")
	}
}

func playTestTone(frequency float64, durationMs int) {
	fmt.Printf("Playing %.0fHz tone for %dms...\n", frequency, durationMs)

	// Generate WAV data
	wavData := generateToneWav(frequency, durationMs, 0.3)

	// Write to temp file
	tmpFile := "/tmp/hwtest_tone.wav"
	if err := os.WriteFile(tmpFile, wavData, 0644); err != nil {
		fmt.Printf("ERROR: Could not write temp file: %v\n", err)
		return
	}
	defer os.Remove(tmpFile)

	// Play with aplay
	cmd := exec.Command("aplay", "-q", tmpFile)
	if err := cmd.Run(); err != nil {
		fmt.Printf("ERROR: aplay failed: %v\n", err)
		fmt.Println("Check that your I2S DAC is properly configured and connected.")
		return
	}

	fmt.Println("Done.")
}

func playScale() {
	fmt.Println("Playing C major scale...")

	// C4 to C5
	notes := []float64{261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25}
	noteNames := []string{"C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"}

	for i, freq := range notes {
		fmt.Printf("  %s (%.1fHz)\n", noteNames[i], freq)
		wavData := generateToneWav(freq, 300, 0.3)

		tmpFile := "/tmp/hwtest_tone.wav"
		if err := os.WriteFile(tmpFile, wavData, 0644); err != nil {
			fmt.Printf("ERROR: Could not write temp file: %v\n", err)
			return
		}

		cmd := exec.Command("aplay", "-q", tmpFile)
		if err := cmd.Run(); err != nil {
			fmt.Printf("ERROR: aplay failed: %v\n", err)
			os.Remove(tmpFile)
			return
		}

		os.Remove(tmpFile)
		time.Sleep(100 * time.Millisecond)
	}

	fmt.Println("Done.")
}

func playSpeakerTest() {
	fmt.Println("Running speaker-test (stereo, 2 seconds)...")
	fmt.Println("Press Ctrl+C to stop.")

	cmd := exec.Command("speaker-test", "-t", "wav", "-c", "2", "-l", "1")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		fmt.Printf("speaker-test exited: %v\n", err)
	}
}

func generateToneWav(frequency float64, durationMs int, volume float64) []byte {
	const sampleRate = 44100
	numSamples := durationMs * sampleRate / 1000
	fadeSamples := 10 * sampleRate / 1000 // 10ms fade

	// Generate samples
	samples := make([]int16, numSamples)
	for i := range samples {
		sample := math.Sin(2*math.Pi*frequency*float64(i)/sampleRate) * volume

		// Fade in/out
		if i < fadeSamples {
			sample *= float64(i) / float64(fadeSamples)
		} else if i > numSamples-fadeSamples {
			sample *= float64(numSamples-i) / float64(fadeSamples)
		}

		samples[i] = int16(sample * 32767)
	}

	// Build WAV file
	dataSize := uint32(numSamples * 2)
	fileSize := 36 + dataSize

	buf := make([]byte, 0, 44+dataSize)

	// RIFF header
	buf = append(buf, []byte("RIFF")...)
	buf = binary.LittleEndian.AppendUint32(buf, fileSize)
	buf = append(buf, []byte("WAVE")...)

	// fmt chunk
	buf = append(buf, []byte("fmt ")...)
	buf = binary.LittleEndian.AppendUint32(buf, 16)     // Chunk size
	buf = binary.LittleEndian.AppendUint16(buf, 1)      // Audio format (PCM)
	buf = binary.LittleEndian.AppendUint16(buf, 1)      // Num channels (mono)
	buf = binary.LittleEndian.AppendUint32(buf, sampleRate)
	buf = binary.LittleEndian.AppendUint32(buf, sampleRate*2) // Byte rate
	buf = binary.LittleEndian.AppendUint16(buf, 2)      // Block align
	buf = binary.LittleEndian.AppendUint16(buf, 16)     // Bits per sample

	// data chunk
	buf = append(buf, []byte("data")...)
	buf = binary.LittleEndian.AppendUint32(buf, dataSize)

	// Sample data
	for _, sample := range samples {
		buf = binary.LittleEndian.AppendUint16(buf, uint16(sample))
	}

	return buf
}

// =============================================================================
// Test All
// =============================================================================

func testAll() {
	fmt.Println("\n=== Testing All Hardware ===")
	fmt.Println()

	// Quick NFC check
	fmt.Println("--- NFC Reader Quick Check ---")
	checkNFC()
	fmt.Println()

	// Quick speaker check
	fmt.Println("--- Speaker Quick Check ---")
	fmt.Println("Playing startup chime...")
	playStartupChime()
	fmt.Println()

	// Button test (interactive)
	fmt.Println("--- Button Test ---")
	fmt.Println("Now entering interactive button test.")
	testButtons()
}

func checkNFC() {
	i2cPath := fmt.Sprintf("/dev/i2c-%d", nfcI2CBus)
	if _, err := os.Stat(i2cPath); os.IsNotExist(err) {
		fmt.Printf("FAIL: I2C bus not found at %s\n", i2cPath)
		return
	}

	bus, err := i2creg.Open(fmt.Sprintf("%d", nfcI2CBus))
	if err != nil {
		fmt.Printf("FAIL: Could not open I2C bus: %v\n", err)
		return
	}
	defer bus.Close()

	dev := &i2c.Dev{Bus: bus, Addr: nfcI2CAddress}

	_ = dev.Tx([]byte{0x00}, nil)
	time.Sleep(50 * time.Millisecond)

	firmware, err := nfcGetFirmware(dev)
	if err != nil {
		fmt.Printf("FAIL: PN532 not responding: %v\n", err)
		return
	}

	fmt.Printf("OK: PN532 detected (IC=0x%02X, v%d.%d)\n",
		firmware.ic, firmware.version, firmware.revision)
}

func playStartupChime() {
	// C major arpeggio: C5, E5, G5, C6
	notes := []float64{523.25, 659.25, 783.99, 1046.50}
	durations := []int{120, 120, 120, 200}

	for i, freq := range notes {
		wavData := generateToneWav(freq, durations[i], 0.2)

		tmpFile := "/tmp/hwtest_chime.wav"
		if err := os.WriteFile(tmpFile, wavData, 0644); err != nil {
			continue
		}

		cmd := exec.Command("aplay", "-q", tmpFile)
		_ = cmd.Run()
		os.Remove(tmpFile)

		time.Sleep(30 * time.Millisecond)
	}
	fmt.Println("Done.")
}
