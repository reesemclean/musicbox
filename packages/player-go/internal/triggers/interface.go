// Package triggers provides input sources for player control
package triggers

// PlayerController is the interface that triggers use to control the player
type PlayerController interface {
	HandleCardScan(nfcID string) error
	Play() error
	Pause() error
	Stop() error
	Next() error
	Previous() error
	TogglePlayPause() error
	SetVolume(level int) error
	VolumeUp() error
	VolumeDown() error
	GetVolume() int
	GetStatusJSON() ([]byte, error)

	// Sound machine mode
	ActivateSoundMachine() error
	IsSoundMachineActive() bool
}

// Trigger is the interface for all input sources
type Trigger interface {
	// Name returns the unique name for this trigger
	Name() string

	// Start starts the trigger and connects it to the player
	Start(player PlayerController) error

	// Stop stops the trigger and cleans up resources
	Stop() error
}
