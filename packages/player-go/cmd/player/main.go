// MusicBox Player - Go Implementation
//
// A single static binary that handles NFC card scanning and audio playback
// for the MusicBox project. Designed to run on Raspberry Pi ARM64.
package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/reesemclean/musicbox/packages/player-go/internal/api"
	"github.com/reesemclean/musicbox/packages/player-go/internal/audio"
	"github.com/reesemclean/musicbox/packages/player-go/internal/config"
	"github.com/reesemclean/musicbox/packages/player-go/internal/core"
	"github.com/reesemclean/musicbox/packages/player-go/internal/services"
	"github.com/reesemclean/musicbox/packages/player-go/internal/triggers"
)

// Version is set at build time via -ldflags
var Version = "dev"

func main() {
	// Configure structured logging (Debug level for verbose output)
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	})))

	slog.Info("MusicBox Player starting", "version", Version)

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}

	slog.Info("Configuration loaded", "device", cfg.DeviceName, "server", cfg.ServerURL)

	// Initialize server client
	serverClient := api.NewClient(cfg.ServerURL, cfg.DeviceSecret)

	// Initialize audio cache
	audioCache := audio.NewCache()
	if err := audioCache.Initialize(); err != nil {
		slog.Warn("Failed to initialize audio cache", "error", err)
	}

	// Initialize audio engine
	audioEngine := audio.NewEngine(audioCache)

	// Initialize player core
	playerCore := core.NewPlayerCore(serverClient, audioEngine)
	if err := playerCore.Initialize(); err != nil {
		slog.Error("Failed to initialize player core", "error", err)
		os.Exit(1)
	}

	// Start heartbeat service (if device secret is configured)
	var heartbeatService *services.HeartbeatService
	if cfg.DeviceSecret != "" {
		heartbeatService = services.NewHeartbeatService(serverClient, playerCore, Version)
		heartbeatService.Start()
	} else {
		slog.Warn("No device secret configured - heartbeat disabled")
		slog.Warn("Create a device in the server UI and deploy the config file")
	}

	// Register enabled triggers
	var triggerList []triggers.Trigger

	if cfg.Triggers.Keyboard.Enabled {
		triggerList = append(triggerList, triggers.NewKeyboardTrigger())
	}

	if cfg.Triggers.HTTP.Enabled {
		triggerList = append(triggerList, triggers.NewHTTPTrigger(cfg.Triggers.HTTP.Port))
	}

	if cfg.Triggers.NFC.Enabled {
		triggerList = append(triggerList, triggers.NewNFCTrigger(cfg.Triggers.NFC.I2CBus))
	}

	if cfg.Triggers.Buttons.Enabled {
		triggerList = append(triggerList, triggers.NewButtonTrigger())
	}

	if len(triggerList) == 0 {
		slog.Error("No triggers enabled!")
		slog.Error("Enable at least one trigger via environment variables:")
		slog.Error("  - TRIGGER_KEYBOARD=true")
		slog.Error("  - TRIGGER_HTTP=true")
		slog.Error("  - TRIGGER_NFC=true")
		slog.Error("  - TRIGGER_BUTTONS=true")
		os.Exit(1)
	}

	// Start all triggers
	slog.Info("Starting triggers", "count", len(triggerList))
	for _, trigger := range triggerList {
		if err := trigger.Start(playerCore); err != nil {
			slog.Error("Failed to start trigger", "name", trigger.Name(), "error", err)
		}
	}

	// Play startup chime
	playerCore.PlayReadyChime()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	<-sigCh
	slog.Info("Shutting down...")

	// Stop heartbeat
	if heartbeatService != nil {
		heartbeatService.Stop()
	}

	// Stop triggers
	for _, trigger := range triggerList {
		if err := trigger.Stop(); err != nil {
			slog.Warn("Failed to stop trigger", "name", trigger.Name(), "error", err)
		}
	}

	// Stop player
	if err := playerCore.Shutdown(); err != nil {
		slog.Warn("Failed to shutdown player", "error", err)
	}

	slog.Info("Goodbye!")
}
