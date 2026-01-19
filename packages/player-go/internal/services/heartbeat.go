// Package services provides background services for the player
package services

import (
	"log/slog"
	"math"
	"net"
	"sync"
	"time"

	"github.com/reesemclean/musicbox/packages/player-go/internal/api"
	"github.com/reesemclean/musicbox/packages/player-go/internal/audio"
)

const (
	baseInterval  = 30 * time.Second
	maxBackoff    = 5 * time.Minute
	maxMultiplier = 10
)

// StatusProvider provides current player status
type StatusProvider interface {
	GetStatus() audio.PlayerStatus
}

// HeartbeatService sends periodic heartbeats to the server
type HeartbeatService struct {
	mu                  sync.Mutex
	client              *api.Client
	statusProvider      StatusProvider
	playerVersion       string
	consecutiveFailures int
	stopCh              chan struct{}
	stopped             bool
}

// NewHeartbeatService creates a new heartbeat service
func NewHeartbeatService(client *api.Client, statusProvider StatusProvider, playerVersion string) *HeartbeatService {
	return &HeartbeatService{
		client:         client,
		statusProvider: statusProvider,
		playerVersion:  playerVersion,
		stopCh:         make(chan struct{}),
	}
}

// Start begins sending heartbeats
func (h *HeartbeatService) Start() {
	// Send initial heartbeat
	h.sendHeartbeat()

	// Start heartbeat loop
	go h.loop()

	slog.Info("Heartbeat service started", "interval", baseInterval)
}

// loop runs the heartbeat loop with exponential backoff
func (h *HeartbeatService) loop() {
	for {
		// Calculate delay with exponential backoff
		h.mu.Lock()
		failures := h.consecutiveFailures
		h.mu.Unlock()

		multiplier := math.Min(math.Pow(2, float64(failures)), maxMultiplier)
		delay := time.Duration(float64(baseInterval) * multiplier)
		if delay > maxBackoff {
			delay = maxBackoff
		}

		select {
		case <-h.stopCh:
			return
		case <-time.After(delay):
			h.sendHeartbeat()
		}
	}
}

// Stop stops the heartbeat service
func (h *HeartbeatService) Stop() {
	h.mu.Lock()
	if h.stopped {
		h.mu.Unlock()
		return
	}
	h.stopped = true
	h.mu.Unlock()

	close(h.stopCh)
	slog.Info("Heartbeat service stopped")
}

// sendHeartbeat sends a single heartbeat to the server
func (h *HeartbeatService) sendHeartbeat() {
	status := h.statusProvider.GetStatus()
	ipAddress := getLocalIPAddress()

	var currentSong *api.HeartbeatSongInfo
	if status.CurrentSong != nil {
		currentSong = &api.HeartbeatSongInfo{
			Title:     status.CurrentSong.Title,
			Artist:    status.CurrentSong.Artist,
			IsPlaying: status.IsPlaying,
		}
	}

	err := h.client.SendHeartbeat(ipAddress, currentSong, h.playerVersion)

	h.mu.Lock()
	defer h.mu.Unlock()

	if err != nil {
		h.consecutiveFailures++
		if h.consecutiveFailures == 1 {
			slog.Error("Heartbeat failed", "error", err)
		} else if h.consecutiveFailures%10 == 0 {
			slog.Error("Server still unreachable", "failures", h.consecutiveFailures)
		}
	} else {
		if h.consecutiveFailures > 0 {
			slog.Info("Server connection restored")
		}
		h.consecutiveFailures = 0
	}
}

// getLocalIPAddress returns the local IP address
func getLocalIPAddress() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return "unknown"
	}

	for _, iface := range interfaces {
		// Skip loopback and down interfaces
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			// Skip loopback and IPv6
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}

			return ip.String()
		}
	}

	return "unknown"
}
