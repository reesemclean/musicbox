package core

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/reesemclean/musicbox/packages/player-go/internal/api"
	"github.com/reesemclean/musicbox/packages/player-go/internal/audio"
)

// PlayerCore is the main orchestrator for the MusicBox player
type PlayerCore struct {
	audioEngine  *audio.Engine
	serverClient *api.Client
}

// NewPlayerCore creates a new player core
func NewPlayerCore(serverClient *api.Client, audioEngine *audio.Engine) *PlayerCore {
	return &PlayerCore{
		audioEngine:  audioEngine,
		serverClient: serverClient,
	}
}

// Initialize initializes the audio engine and tone generator
func (p *PlayerCore) Initialize() error {
	if err := p.audioEngine.Initialize(); err != nil {
		return fmt.Errorf("failed to initialize audio engine: %w", err)
	}
	if err := p.audioEngine.InitializeTones(); err != nil {
		return fmt.Errorf("failed to initialize tones: %w", err)
	}
	return nil
}

// PlayReadyChime plays the startup chime
func (p *PlayerCore) PlayReadyChime() {
	p.audioEngine.PlayStartupChime()
	slog.Info("Player ready!")
}

// HandleCardScan handles an NFC card scan
func (p *PlayerCore) HandleCardScan(nfcID string) error {
	// Play confirmation beep immediately
	p.audioEngine.PlayCardBeep()

	slog.Info("Scanning card", "nfcId", nfcID)

	result, err := p.serverClient.ScanCard(nfcID)
	if err != nil {
		p.audioEngine.PlayErrorBeep()
		return err
	}

	if result.Content == nil {
		slog.Warn("Card not recognized")
		p.audioEngine.PlayErrorBeep()
		return nil
	}

	switch result.Content.Type {
	case "song":
		if result.Content.Song != nil {
			song := result.Content.Song
			slog.Info("Playing song", "title", song.Title)
			if song.Artist != nil {
				slog.Info("Artist", "name", *song.Artist)
			}
			p.loadSong(song)
		}

	case "playlist":
		if result.Content.Playlist != nil {
			playlist := result.Content.Playlist
			slog.Info("Loading playlist", "name", playlist.Name, "songs", len(playlist.Songs))
			p.loadPlaylist(playlist)
		}

	case "action":
		if result.Content.Action != nil {
			action := *result.Content.Action
			slog.Info("Action", "action", action)
			p.executeAction(action)
		}

	case "podcast":
		if result.Content.Podcast != nil {
			podcast := result.Content.Podcast
			slog.Info("Playing podcast", "title", podcast.Title)
			p.loadPodcast(podcast)
		}

	default:
		slog.Warn("Card not recognized")
		p.audioEngine.PlayErrorBeep()
	}

	return nil
}

func (p *PlayerCore) loadSong(song *api.SongContent) {
	_ = p.audioEngine.Play(audio.SongInfo{
		ID:        song.ID,
		Title:     song.Title,
		Artist:    song.Artist,
		StreamURL: p.serverClient.GetStreamURL(song.ID),
	})
}

func (p *PlayerCore) loadPlaylist(playlist *api.PlaylistContent) {
	if len(playlist.Songs) == 0 {
		return
	}

	songs := make([]audio.SongInfo, len(playlist.Songs))
	for i, song := range playlist.Songs {
		songs[i] = audio.SongInfo{
			ID:        song.ID,
			Title:     song.Title,
			Artist:    song.Artist,
			StreamURL: p.serverClient.GetStreamURL(song.ID),
		}
	}

	slog.Info("Playing", "title", songs[0].Title)
	_ = p.audioEngine.LoadPlaylist(songs)
}

func (p *PlayerCore) loadPodcast(podcast *api.PodcastContent) {
	if podcast.LatestEpisode == nil {
		slog.Warn("No episodes available for this podcast")
		p.audioEngine.PlayErrorBeep()
		return
	}

	episode := podcast.LatestEpisode
	slog.Info("Playing episode", "title", episode.Title)

	podcastTitle := podcast.Title
	_ = p.audioEngine.Play(audio.SongInfo{
		ID:        episode.ID,
		Title:     episode.Title,
		Artist:    &podcastTitle,
		StreamURL: p.serverClient.GetEpisodeStreamURL(episode.ID),
	})
}

func (p *PlayerCore) executeAction(action api.Action) {
	switch action {
	case api.ActionPlay:
		_ = p.Play()
	case api.ActionPause:
		_ = p.Pause()
	case api.ActionNext:
		_ = p.Next()
	case api.ActionPrevious:
		_ = p.Previous()
	case api.ActionStop:
		_ = p.Stop()
	}
}

// Play resumes playback
func (p *PlayerCore) Play() error {
	return p.audioEngine.Resume()
}

// Pause pauses playback
func (p *PlayerCore) Pause() error {
	return p.audioEngine.Pause()
}

// TogglePlayPause toggles between play and pause
func (p *PlayerCore) TogglePlayPause() error {
	return p.audioEngine.TogglePlayPause()
}

// Next skips to the next track
func (p *PlayerCore) Next() error {
	return p.audioEngine.Next()
}

// Previous goes to the previous track
func (p *PlayerCore) Previous() error {
	return p.audioEngine.Previous()
}

// Stop stops playback
func (p *PlayerCore) Stop() error {
	return p.audioEngine.Stop()
}

// GetStatus returns the current player status
func (p *PlayerCore) GetStatus() audio.PlayerStatus {
	return p.audioEngine.GetStatus()
}

// GetStatusJSON returns the player status as JSON
func (p *PlayerCore) GetStatusJSON() ([]byte, error) {
	status := p.GetStatus()

	resp := struct {
		CurrentSong      *audio.SongInfo `json:"currentSong"`
		IsPlaying        bool            `json:"isPlaying"`
		PlaylistPosition *string         `json:"playlistPosition"`
		Volume           int             `json:"volume"`
	}{
		CurrentSong:      status.CurrentSong,
		IsPlaying:        status.IsPlaying,
		PlaylistPosition: status.PlaylistPosition,
		Volume:           status.Volume,
	}

	return json.Marshal(resp)
}

// SetVolume sets the volume level
func (p *PlayerCore) SetVolume(percent int) error {
	return p.audioEngine.SetVolume(percent)
}

// GetVolume returns the current volume
func (p *PlayerCore) GetVolume() int {
	return p.audioEngine.GetVolume()
}

// VolumeUp increases the volume
func (p *PlayerCore) VolumeUp() error {
	return p.audioEngine.VolumeUp(10)
}

// VolumeDown decreases the volume
func (p *PlayerCore) VolumeDown() error {
	return p.audioEngine.VolumeDown(10)
}

// Shutdown shuts down the player
func (p *PlayerCore) Shutdown() error {
	return p.audioEngine.Shutdown()
}
