package triggers

import (
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"time"

	"periph.io/x/conn/v3/gpio"
	"periph.io/x/conn/v3/gpio/gpioreg"
	"periph.io/x/host/v3"
)

const (
	debounceMs           = 200
	restartPressesNeeded = 5
	restartWindowMs      = 3000
	volumeDownPin        = 13
)

type buttonConfig struct {
	pin    int
	action string
	label  string
}

// ButtonTrigger provides physical button controls via GPIO using periph.io
type ButtonTrigger struct {
	mu             sync.Mutex
	player         PlayerController
	buttons        []buttonConfig
	pins           []gpio.PinIO
	lastPressTime  map[int]time.Time
	restartPresses []time.Time
	stopCh         chan struct{}
	stopped        bool
	wg             sync.WaitGroup
}

// NewButtonTrigger creates a new button trigger
func NewButtonTrigger() *ButtonTrigger {
	return &ButtonTrigger{
		buttons: []buttonConfig{
			{pin: 5, action: "play-pause", label: "Play/Pause"},
			{pin: 6, action: "volume-up", label: "Volume Up"},
			{pin: 13, action: "volume-down", label: "Volume Down"},
			{pin: 16, action: "next", label: "Next Track"},
			{pin: 26, action: "previous", label: "Previous Track"},
		},
		lastPressTime:  make(map[int]time.Time),
		restartPresses: make([]time.Time, 0),
		stopCh:         make(chan struct{}),
	}
}

// Name returns the trigger name
func (b *ButtonTrigger) Name() string {
	return "buttons"
}

// Start starts the button monitoring using periph.io
func (b *ButtonTrigger) Start(player PlayerController) error {
	b.player = player

	slog.Debug("Button trigger: Starting initialization")

	// Initialize periph.io
	if _, err := host.Init(); err != nil {
		slog.Warn("Button trigger: Failed to initialize periph.io", "error", err)
		return nil // Non-fatal
	}

	slog.Info("Button trigger initializing (periph.io)...")

	// Configure each button pin
	for _, btn := range b.buttons {
		slog.Debug("Button trigger: Configuring pin", "gpio", btn.pin, "action", btn.action)
		pin := gpioreg.ByName(pinName(btn.pin))
		if pin == nil {
			slog.Warn("Button trigger: GPIO pin not found", "pin", btn.pin)
			continue
		}

		// Configure pin with pull-up and falling edge detection
		if err := pin.In(gpio.PullUp, gpio.FallingEdge); err != nil {
			slog.Warn("Button trigger: Failed to configure pin", "pin", btn.pin, "error", err)
			continue
		}

		b.pins = append(b.pins, pin)
		slog.Info("Button mapping", "gpio", btn.pin, "action", btn.label)

		// Start a goroutine to monitor this pin
		b.wg.Add(1)
		go b.monitorPin(pin, btn.pin)
	}

	if len(b.pins) == 0 {
		slog.Warn("Button trigger: No GPIO pins configured - button trigger disabled")
		return nil
	}

	slog.Info("Button trigger started", "pins", len(b.pins))
	return nil
}

// pinName converts a BCM pin number to periph.io pin name
func pinName(bcmPin int) string {
	// periph.io uses "GPIO" prefix for BCM pin numbers
	return "GPIO" + itoa(bcmPin)
}

// itoa converts int to string without importing strconv
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// monitorPin watches a single GPIO pin for edge events
func (b *ButtonTrigger) monitorPin(pin gpio.PinIO, pinNum int) {
	defer b.wg.Done()

	slog.Debug("Button trigger: Starting monitor for pin", "gpio", pinNum)

	for {
		select {
		case <-b.stopCh:
			slog.Debug("Button trigger: Monitor stopping for pin", "gpio", pinNum)
			return
		default:
		}

		// Wait for falling edge (button press) with timeout
		// Using timeout allows us to check stopCh periodically
		if pin.WaitForEdge(500 * time.Millisecond) {
			slog.Debug("Button trigger: Edge detected on pin", "gpio", pinNum)
			b.handleButtonPress(pinNum)
		}
	}
}

// Stop stops the button trigger
func (b *ButtonTrigger) Stop() error {
	b.mu.Lock()
	if b.stopped {
		b.mu.Unlock()
		return nil
	}
	b.stopped = true
	b.mu.Unlock()

	close(b.stopCh)

	// Wait for all monitor goroutines to finish
	b.wg.Wait()

	// Halt all pins
	for _, pin := range b.pins {
		_ = pin.Halt()
	}

	slog.Info("Button trigger stopped")
	return nil
}

func (b *ButtonTrigger) handleButtonPress(pin int) {
	now := time.Now()

	b.mu.Lock()
	lastPress := b.lastPressTime[pin]
	timeSinceLast := now.Sub(lastPress)

	// Debounce
	if timeSinceLast < debounceMs*time.Millisecond {
		slog.Debug("Button trigger: Debouncing press", "gpio", pin, "timeSinceLast", timeSinceLast)
		b.mu.Unlock()
		return
	}

	b.lastPressTime[pin] = now
	b.mu.Unlock()

	// Check for restart combo
	b.checkRestartCombo(pin, now)

	// Find button config
	var button *buttonConfig
	for i := range b.buttons {
		if b.buttons[i].pin == pin {
			button = &b.buttons[i]
			break
		}
	}
	if button == nil {
		slog.Debug("Button trigger: Unknown pin pressed", "gpio", pin)
		return
	}

	slog.Info("Button pressed", "label", button.label, "gpio", pin)
	slog.Debug("Button trigger: Executing action", "action", button.action)
	b.executeAction(button.action)
}

func (b *ButtonTrigger) checkRestartCombo(pin int, now time.Time) {
	if pin != volumeDownPin {
		// Any other button resets restart tracking
		b.mu.Lock()
		if len(b.restartPresses) > 0 {
			slog.Debug("Button trigger: Restart combo reset by other button", "gpio", pin)
		}
		b.restartPresses = b.restartPresses[:0]
		b.mu.Unlock()
		return
	}

	b.mu.Lock()
	// Add this press
	b.restartPresses = append(b.restartPresses, now)

	// Remove old presses outside the window
	cutoff := now.Add(-restartWindowMs * time.Millisecond)
	filtered := make([]time.Time, 0, len(b.restartPresses))
	for _, t := range b.restartPresses {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	b.restartPresses = filtered

	count := len(b.restartPresses)
	b.mu.Unlock()

	slog.Debug("Button trigger: Restart combo check", "count", count, "needed", restartPressesNeeded)

	if count >= restartPressesNeeded {
		b.mu.Lock()
		b.restartPresses = b.restartPresses[:0]
		b.mu.Unlock()
		b.triggerRestart()
	} else if count >= 3 {
		slog.Info("Restart progress", "count", count, "needed", restartPressesNeeded)
	}
}

func (b *ButtonTrigger) triggerRestart() {
	slog.Info("Restarting musicbox-player service...")

	cmd := exec.Command("systemctl", "restart", "musicbox-player")
	if err := cmd.Run(); err != nil {
		slog.Error("Failed to restart service", "error", err)
		// Fallback: exit process (systemd will restart it)
		os.Exit(1)
	}
}

func (b *ButtonTrigger) executeAction(action string) {
	if b.player == nil {
		return
	}

	switch action {
	case "play-pause":
		_ = b.player.TogglePlayPause()
	case "volume-up":
		_ = b.player.VolumeUp()
	case "volume-down":
		_ = b.player.VolumeDown()
	case "next":
		_ = b.player.Next()
	case "previous":
		_ = b.player.Previous()
	}
}
