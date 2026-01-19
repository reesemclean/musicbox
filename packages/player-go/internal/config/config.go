// Package config handles configuration loading from multiple sources
package config

import (
	"bufio"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

// Boot partition paths (managed by agent)
// Note: On Raspberry Pi OS Bookworm, boot is at /boot/firmware/
const (
	bootSecretPath = "/boot/firmware/musicbox/device.txt" //nolint:gosec // Not credentials, just a file path
	bootConfigPath = "/boot/firmware/musicbox/config.txt"
)

// TriggersConfig holds configuration for all trigger types
type TriggersConfig struct {
	Keyboard KeyboardTriggerConfig `json:"keyboard"`
	HTTP     HTTPTriggerConfig     `json:"http"`
	NFC      NFCTriggerConfig      `json:"nfc"`
	Buttons  ButtonTriggerConfig   `json:"buttons"`
}

// KeyboardTriggerConfig holds keyboard trigger settings
type KeyboardTriggerConfig struct {
	Enabled bool `json:"enabled"`
}

// HTTPTriggerConfig holds HTTP trigger settings
type HTTPTriggerConfig struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

// NFCTriggerConfig holds NFC trigger settings
type NFCTriggerConfig struct {
	Enabled bool `json:"enabled"`
	I2CBus  int  `json:"i2cBus"`
}

// ButtonTriggerConfig holds button trigger settings
type ButtonTriggerConfig struct {
	Enabled bool `json:"enabled"`
}

// PlayerConfig holds all player configuration
type PlayerConfig struct {
	DeviceID     int            `json:"deviceId"`
	DeviceName   string         `json:"deviceName"`
	DeviceSecret string         `json:"deviceSecret"`
	ServerURL    string         `json:"serverUrl"`
	HTTPPort     int            `json:"httpPort"`
	Triggers     TriggersConfig `json:"triggers"`
}

// loadBootConfig attempts to load config from boot partition (agent-managed)
func loadBootConfig() (serverURL, deviceSecret string, ok bool) {
	data, err := os.ReadFile(bootSecretPath)
	if err != nil {
		return "", "", false
	}

	deviceSecret = strings.TrimSpace(string(data))
	if deviceSecret == "" {
		return "", "", false
	}

	// Read server URL from config file (required)
	file, err := os.Open(bootConfigPath)
	if err != nil {
		slog.Error("Boot config file not found", "path", bootConfigPath)
		return "", "", false
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "SERVER_URL=") {
			serverURL = strings.TrimSpace(strings.TrimPrefix(line, "SERVER_URL="))
			break
		}
	}

	if serverURL == "" {
		slog.Error("SERVER_URL not set in boot config", "path", bootConfigPath)
		return "", "", false
	}

	return serverURL, deviceSecret, true
}

// getEnvBool returns true if env var equals "true", false otherwise
func getEnvBool(key string) bool {
	return os.Getenv(key) == "true"
}

// getEnvBoolInverse returns false if env var equals "false", otherwise true
func getEnvBoolInverse(key string) bool {
	val := os.Getenv(key)
	if val == "" {
		return true
	}
	return val != "false"
}

// getEnvInt returns the env var as int, or the default if not set or invalid
func getEnvInt(key string, defaultVal int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	if i, err := strconv.Atoi(val); err == nil {
		return i
	}
	return defaultVal
}

// getHostname returns the system hostname or a fallback
func getHostname() string {
	if name, err := os.Hostname(); err == nil {
		return name
	}
	return "musicbox-player"
}

// Load loads the player configuration from available sources
// Priority: boot partition > environment variables
func Load() (*PlayerConfig, error) {
	// First, try boot partition config (agent-managed deployment)
	if serverURL, deviceSecret, ok := loadBootConfig(); ok {
		slog.Info("Loading config from boot partition")
		return &PlayerConfig{
			DeviceID:     0,
			DeviceName:   getHostname(),
			DeviceSecret: deviceSecret,
			ServerURL:    serverURL,
			HTTPPort:     getEnvInt("HTTP_PORT", 8080),
			Triggers: TriggersConfig{
				Keyboard: KeyboardTriggerConfig{
					Enabled: getEnvBool("TRIGGER_KEYBOARD"),
				},
				HTTP: HTTPTriggerConfig{
					Enabled: getEnvBoolInverse("TRIGGER_HTTP"),
					Port:    getEnvInt("HTTP_PORT", 8080),
				},
				NFC: NFCTriggerConfig{
					Enabled: getEnvBoolInverse("TRIGGER_NFC"),
					I2CBus:  getEnvInt("NFC_I2C_BUS", 1),
				},
				Buttons: ButtonTriggerConfig{
					Enabled: getEnvBoolInverse("TRIGGER_BUTTONS"),
				},
			},
		}, nil
	}

	// Fall back to environment variables (development mode)
	slog.Warn("Boot config not found, using environment variables")
	return &PlayerConfig{
		DeviceID:     0,
		DeviceName:   getEnvOrDefault("DEVICE_NAME", "dev-player"),
		DeviceSecret: os.Getenv("DEVICE_SECRET"),
		ServerURL:    getEnvOrDefault("SERVER_URL", "http://localhost:3000"),
		HTTPPort:     getEnvInt("HTTP_PORT", 8080),
		Triggers: TriggersConfig{
			Keyboard: KeyboardTriggerConfig{
				Enabled: getEnvBoolInverse("TRIGGER_KEYBOARD"),
			},
			HTTP: HTTPTriggerConfig{
				Enabled: getEnvBool("TRIGGER_HTTP"),
				Port:    getEnvInt("HTTP_PORT", 8080),
			},
			NFC: NFCTriggerConfig{
				Enabled: getEnvBool("TRIGGER_NFC"),
				I2CBus:  getEnvInt("NFC_I2C_BUS", 1),
			},
			Buttons: ButtonTriggerConfig{
				Enabled: getEnvBool("TRIGGER_BUTTONS"),
			},
		},
	}, nil
}

// getEnvOrDefault returns the env var value or the default if not set
func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
