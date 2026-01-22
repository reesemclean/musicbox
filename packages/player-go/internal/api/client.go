package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

var (
	// ErrCardNotRegistered is returned when the scanned card is not registered
	ErrCardNotRegistered = errors.New("card not registered")
	// ErrNetworkError is returned when there's a network issue
	ErrNetworkError = errors.New("network error")
	// ErrInvalidResponse is returned when the server returns invalid JSON
	ErrInvalidResponse = errors.New("invalid response from server")
)

// Client handles HTTP communication with the MusicBox server
type Client struct {
	serverURL    string
	deviceSecret string
	httpClient   *http.Client
}

// NewClient creates a new server API client
func NewClient(serverURL, deviceSecret string) *Client {
	return &Client{
		serverURL:    serverURL,
		deviceSecret: deviceSecret,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ScanCard scans an NFC card and retrieves its content mapping
func (c *Client) ScanCard(nfcID string) (*NFCScanResponse, error) {
	slog.Debug("ScanCard called", "nfcId", nfcID)

	reqBody := NFCScanRequest{
		Secret: c.deviceSecret,
		NFCID:  nfcID,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/api/nfc/scan", c.serverURL)
	slog.Debug("Sending scan request", "url", url)

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Error("Network error scanning card",
			"error", err,
			"serverUrl", c.serverURL)
		return nil, fmt.Errorf("%w: %v", ErrNetworkError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	slog.Debug("Scan response received", "status", resp.StatusCode, "bodyLen", len(body))

	// Handle non-OK responses (except 422 which we handle specially)
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusUnprocessableEntity {
		slog.Error("Failed to scan card",
			"status", resp.StatusCode,
			"body", string(body))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	// Handle 422 - card not registered
	if resp.StatusCode == http.StatusUnprocessableEntity {
		slog.Warn("Card not registered",
			"nfcId", nfcID,
			"registerAt", fmt.Sprintf("%s/cards", c.serverURL))
		return nil, ErrCardNotRegistered
	}

	// Parse successful response
	var scanResp NFCScanResponse
	if err := json.Unmarshal(body, &scanResp); err != nil {
		slog.Error("Invalid JSON response",
			"error", err,
			"body", string(body))
		return nil, ErrInvalidResponse
	}

	if !scanResp.Success {
		// Try to parse as error response
		var errResp NFCScanErrorResponse
		if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
			return nil, fmt.Errorf("scan failed: %s", errResp.Error)
		}
		return nil, errors.New("scan failed: unknown error")
	}

	slog.Debug("Scan successful", "contentType", scanResp.Content.Type)
	return &scanResp, nil
}

// GetStreamURL constructs the streaming URL for a song
func (c *Client) GetStreamURL(songID int) string {
	url := fmt.Sprintf("%s/api/stream/%d", c.serverURL, songID)
	slog.Debug("Generated stream URL", "songId", songID, "url", url)
	return url
}

// GetEpisodeStreamURL constructs the streaming URL for a podcast episode
func (c *Client) GetEpisodeStreamURL(episodeID int) string {
	url := fmt.Sprintf("%s/api/stream/episode/%d", c.serverURL, episodeID)
	slog.Debug("Generated episode stream URL", "episodeId", episodeID, "url", url)
	return url
}

// GetServerURL returns the server URL
func (c *Client) GetServerURL() string {
	return c.serverURL
}

// GetSoundMachineConfig fetches the sound machine configuration for this device
func (c *Client) GetSoundMachineConfig() (*SoundMachineConfig, error) {
	slog.Debug("Fetching sound machine config")

	url := fmt.Sprintf("%s/api/soundmachine/config", c.serverURL)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add device secret header for authentication
	req.Header.Set("X-Device-Secret", c.deviceSecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Error("Network error fetching sound machine config", "error", err)
		return nil, fmt.Errorf("%w: %v", ErrNetworkError, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		slog.Error("Failed to get sound machine config",
			"status", resp.StatusCode,
			"body", string(body))
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	var config SoundMachineConfig
	if err := json.Unmarshal(body, &config); err != nil {
		slog.Error("Invalid JSON response", "error", err, "body", string(body))
		return nil, ErrInvalidResponse
	}

	slog.Debug("Sound machine config received", "soundName", config.SoundName, "streamUrl", config.StreamURL)
	return &config, nil
}

// SendHeartbeat sends a heartbeat to the server
func (c *Client) SendHeartbeat(ipAddress string, currentSong *HeartbeatSongInfo, playerVersion string) error {
	slog.Debug("Sending heartbeat", "ipAddress", ipAddress, "hasSong", currentSong != nil, "version", playerVersion)

	reqBody := HeartbeatRequest{
		Secret:        c.deviceSecret,
		IPAddress:     ipAddress,
		CurrentSong:   currentSong,
		PlayerVersion: playerVersion,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("failed to marshal heartbeat: %w", err)
	}

	url := fmt.Sprintf("%s/api/devices/heartbeat", c.serverURL)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		slog.Debug("Heartbeat network error", "error", err)
		return fmt.Errorf("%w: %v", ErrNetworkError, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Debug("Heartbeat failed", "status", resp.StatusCode, "body", string(body))
		return fmt.Errorf("heartbeat failed: HTTP %d: %s", resp.StatusCode, string(body))
	}

	slog.Debug("Heartbeat successful")
	return nil
}
