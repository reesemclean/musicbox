package triggers

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// KeyboardTrigger provides keyboard input for testing
type KeyboardTrigger struct {
	mu      sync.Mutex
	player  PlayerController
	stopCh  chan struct{}
	stopped bool
	scanner *bufio.Scanner
}

// NewKeyboardTrigger creates a new keyboard trigger
func NewKeyboardTrigger() *KeyboardTrigger {
	return &KeyboardTrigger{
		stopCh: make(chan struct{}),
	}
}

// Name returns the trigger name
func (k *KeyboardTrigger) Name() string {
	return "keyboard"
}

// Start starts the keyboard input loop
func (k *KeyboardTrigger) Start(player PlayerController) error {
	k.player = player
	k.scanner = bufio.NewScanner(os.Stdin)

	go func() {
		// Print instructions after other triggers start
		fmt.Println()
		fmt.Println("Player ready!")
		fmt.Println("   Type NFC card ID and press ENTER to scan")
		fmt.Println("   Type 'status' to see current playback state")
		fmt.Println("   Type 'stop' to stop playback")
		fmt.Println("   Press Ctrl+C to exit")
		fmt.Println()
		fmt.Print("Card ID: ")

		for {
			select {
			case <-k.stopCh:
				return
			default:
			}

			if !k.scanner.Scan() {
				return
			}

			input := strings.TrimSpace(k.scanner.Text())
			if input == "" {
				fmt.Print("Card ID: ")
				continue
			}

			switch strings.ToLower(input) {
			case "status":
				k.printStatus()
			case "stop":
				_ = k.player.Stop()
			default:
				// Treat as NFC card ID
				if err := k.player.HandleCardScan(input); err != nil {
					slog.Error("Card scan failed", "error", err)
				}
			}

			fmt.Print("Card ID: ")
		}
	}()

	return nil
}

// Stop stops the keyboard trigger
func (k *KeyboardTrigger) Stop() error {
	k.mu.Lock()
	if k.stopped {
		k.mu.Unlock()
		return nil
	}
	k.stopped = true
	k.mu.Unlock()

	close(k.stopCh)
	return nil
}

func (k *KeyboardTrigger) printStatus() {
	statusJSON, err := k.player.GetStatusJSON()
	if err != nil {
		slog.Error("Failed to get status", "error", err)
		return
	}

	fmt.Println()
	fmt.Println(strings.Repeat("=", 60))
	fmt.Println(string(statusJSON))
	fmt.Println(strings.Repeat("=", 60))
}
