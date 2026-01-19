// Package audio provides audio playback functionality
package audio

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"sync"
	"time"
)

// SongInfo represents a song for playback
type SongInfo struct {
	ID        int
	Title     string
	Artist    *string
	StreamURL string
}

// PlayerStatus represents the current player state
type PlayerStatus struct {
	CurrentSong      *SongInfo
	IsPlaying        bool
	PlaylistPosition *string // "N/M" format or nil
	Volume           int
}

const (
	ipcPath        = "/tmp/musicbox-mpv.sock"
	commandTimeout = 5 * time.Second
	defaultVolume  = 10
)

// mpvResponse represents a response from mpv IPC
type mpvResponse struct {
	Event     string      `json:"event,omitempty"`
	Data      interface{} `json:"data,omitempty"`
	RequestID *int        `json:"request_id,omitempty"`
	Error     string      `json:"error,omitempty"`
	Name      string      `json:"name,omitempty"`
	Reason    string      `json:"reason,omitempty"`
}

// mpvCommand represents a command to send to mpv
type mpvCommand struct {
	Command   []interface{} `json:"command"`
	RequestID int           `json:"request_id"`
}

// CompletionCallback is called when a track completes
type CompletionCallback func()

// Engine manages audio playback via mpv IPC
type Engine struct {
	mu sync.Mutex

	mpvCmd        *exec.Cmd
	ipcConn       net.Conn
	currentVolume int
	isInitialized bool
	requestID     int

	// Request tracking
	pendingMu       sync.Mutex
	pendingRequests map[int]chan mpvResponse

	// Playlist tracking
	playlist []SongInfo

	// Callbacks
	completionCallbacks []CompletionCallback

	// Tone generator
	toneGenerator *ToneGenerator

	// Audio cache
	cache *Cache

	// Shutdown
	done chan struct{}
}

// NewEngine creates a new audio engine
func NewEngine(cache *Cache) *Engine {
	return &Engine{
		currentVolume:       defaultVolume,
		pendingRequests:     make(map[int]chan mpvResponse),
		completionCallbacks: make([]CompletionCallback, 0),
		toneGenerator:       NewToneGenerator(),
		cache:               cache,
		done:                make(chan struct{}),
	}
}

// Initialize starts mpv and connects to the IPC socket
func (e *Engine) Initialize() error {
	e.mu.Lock()
	if e.isInitialized {
		e.mu.Unlock()
		slog.Debug("Audio engine already initialized")
		return nil
	}
	e.mu.Unlock()

	slog.Debug("Initializing audio engine")

	// Clean up stale socket
	if _, err := os.Stat(ipcPath); err == nil {
		slog.Debug("Removing stale IPC socket", "path", ipcPath)
		os.Remove(ipcPath)
	}

	// Start mpv
	slog.Debug("Starting mpv process")
	if err := e.startMpv(); err != nil {
		return fmt.Errorf("failed to start mpv: %w", err)
	}

	e.mu.Lock()
	e.isInitialized = true
	volume := e.currentVolume
	e.mu.Unlock()

	// Set initial volume
	slog.Debug("Setting initial volume", "volume", volume)
	if err := e.setMpvVolume(volume); err != nil {
		slog.Warn("Failed to set initial volume", "error", err)
	}

	slog.Info("mpv audio engine initialized")
	return nil
}

// startMpv starts the mpv process and connects to IPC
func (e *Engine) startMpv() error {
	args := []string{
		"--idle=yes",                    // Stay running, wait for commands
		"--input-ipc-server=" + ipcPath, // IPC socket path
		"--no-video",                    // Audio only
		"--no-terminal",                 // No terminal output
		"--really-quiet",                // Minimal logging
		"--audio-display=no",            // No visualizations
		"--gapless-audio=yes",           // Gapless playback
		"--prefetch-playlist=yes",       // Prefetch next track
		"--audio-buffer=0.2",            // 200ms buffer
		"--audio-stream-silence=yes",    // Keep audio stream open with silence
	}

	slog.Debug("Launching mpv", "args", args)
	e.mpvCmd = exec.Command("mpv", args...)
	e.mpvCmd.Stdout = nil
	e.mpvCmd.Stderr = nil

	if err := e.mpvCmd.Start(); err != nil {
		return fmt.Errorf("failed to start mpv: %w", err)
	}
	slog.Debug("mpv process started", "pid", e.mpvCmd.Process.Pid)

	// Wait for IPC socket to be created
	slog.Debug("Waiting for IPC socket", "path", ipcPath)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(ipcPath); err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if _, err := os.Stat(ipcPath); err != nil {
		slog.Debug("IPC socket not created within timeout")
		_ = e.mpvCmd.Process.Kill()
		return errors.New("timeout waiting for mpv IPC socket")
	}

	// Connect to IPC socket
	slog.Debug("Connecting to IPC socket")
	conn, err := net.Dial("unix", ipcPath)
	if err != nil {
		_ = e.mpvCmd.Process.Kill()
		return fmt.Errorf("failed to connect to mpv IPC: %w", err)
	}
	e.ipcConn = conn
	slog.Debug("Connected to mpv IPC socket")

	// Start reading responses
	go e.readIpcResponses()

	// Observe end-file events
	_, _ = e.sendCommand([]interface{}{"observe_property", 1, "eof-reached"}, false)

	// Monitor mpv process
	go func() {
		_ = e.mpvCmd.Wait()
		e.mu.Lock()
		e.mpvCmd = nil
		e.ipcConn = nil
		e.isInitialized = false
		e.mu.Unlock()
		slog.Warn("mpv process exited")
	}()

	return nil
}

// readIpcResponses reads and processes responses from mpv
func (e *Engine) readIpcResponses() {
	slog.Debug("Starting mpv IPC response reader")
	reader := bufio.NewReader(e.ipcConn)
	for {
		select {
		case <-e.done:
			slog.Debug("mpv IPC reader shutting down")
			return
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			slog.Debug("mpv IPC read error", "error", err)
			return
		}

		var resp mpvResponse
		if err := json.Unmarshal([]byte(line), &resp); err != nil {
			slog.Debug("Failed to parse mpv response", "line", line, "error", err)
			continue
		}

		// Log all events for debugging
		if resp.Event != "" {
			slog.Debug("mpv event", "event", resp.Event, "name", resp.Name, "data", resp.Data, "reason", resp.Reason)
		}

		// Handle property change events
		if resp.Event == "property-change" && resp.Name == "eof-reached" {
			if b, ok := resp.Data.(bool); ok && b {
				slog.Debug("Track EOF reached")
				go e.handleTrackEnd()
			}
		}

		// Handle end-file events
		if resp.Event == "end-file" && resp.Reason == "eof" {
			slog.Debug("End-file event received", "reason", resp.Reason)
			go e.handleTrackEnd()
		}

		// Handle responses to our commands
		if resp.RequestID != nil {
			slog.Debug("mpv response", "requestId", *resp.RequestID, "error", resp.Error, "data", resp.Data)
			e.pendingMu.Lock()
			if ch, ok := e.pendingRequests[*resp.RequestID]; ok {
				delete(e.pendingRequests, *resp.RequestID)
				ch <- resp
				close(ch)
			}
			e.pendingMu.Unlock()
		}
	}
}

// handleTrackEnd handles track completion
func (e *Engine) handleTrackEnd() {
	position := e.getPlaylistPosition()
	e.mu.Lock()
	playlistLen := len(e.playlist)
	e.mu.Unlock()

	if position < 0 || position >= playlistLen {
		e.mu.Lock()
		if playlistLen > 0 {
			lastSong := e.playlist[playlistLen-1]
			slog.Info("Finished playing", "title", lastSong.Title)
			slog.Info("Playlist complete")
		}
		e.mu.Unlock()
	} else {
		e.mu.Lock()
		if position < len(e.playlist) {
			song := e.playlist[position]
			slog.Info("Now playing", "title", song.Title)
		}
		e.mu.Unlock()
	}

	// Notify callbacks
	e.mu.Lock()
	callbacks := make([]CompletionCallback, len(e.completionCallbacks))
	copy(callbacks, e.completionCallbacks)
	e.mu.Unlock()

	for _, cb := range callbacks {
		cb()
	}
}

// sendCommand sends a command to mpv
func (e *Engine) sendCommand(command []interface{}, waitForResponse bool) (*mpvResponse, error) {
	if e.ipcConn == nil {
		return nil, errors.New("IPC socket not connected")
	}

	e.mu.Lock()
	e.requestID++
	reqID := e.requestID
	e.mu.Unlock()

	cmd := mpvCommand{
		Command:   command,
		RequestID: reqID,
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal command: %w", err)
	}

	slog.Debug("Sending mpv command", "requestId", reqID, "command", command, "waitForResponse", waitForResponse)

	var respCh chan mpvResponse
	if waitForResponse {
		respCh = make(chan mpvResponse, 1)
		e.pendingMu.Lock()
		e.pendingRequests[reqID] = respCh
		e.pendingMu.Unlock()
	}

	_, err = e.ipcConn.Write(append(data, '\n'))
	if err != nil {
		if waitForResponse {
			e.pendingMu.Lock()
			delete(e.pendingRequests, reqID)
			e.pendingMu.Unlock()
		}
		return nil, fmt.Errorf("failed to write command: %w", err)
	}

	if !waitForResponse {
		return nil, nil
	}

	select {
	case resp := <-respCh:
		slog.Debug("mpv command response", "requestId", reqID, "error", resp.Error)
		return &resp, nil
	case <-time.After(commandTimeout):
		e.pendingMu.Lock()
		delete(e.pendingRequests, reqID)
		e.pendingMu.Unlock()
		slog.Debug("mpv command timeout", "requestId", reqID)
		return nil, errors.New("command timeout")
	}
}

// getPlaybackURL returns the URL for playback (cached or stream)
func (e *Engine) getPlaybackURL(song SongInfo) (url string, cached bool) {
	if e.cache != nil && e.cache.IsCached(song.ID) {
		if path := e.cache.GetCachedPath(song.ID); path != "" {
			slog.Debug("Using cached file", "songId", song.ID, "path", path)
			return path, true
		}
	}

	// Not cached - prefetch for next time
	if e.cache != nil {
		slog.Debug("Song not cached, starting prefetch", "songId", song.ID)
		go e.cache.Prefetch([]CacheItem{{SongID: song.ID, StreamURL: song.StreamURL}})
	}

	slog.Debug("Using stream URL", "songId", song.ID, "url", song.StreamURL)
	return song.StreamURL, false
}

// Play plays a single song (replaces current playlist)
func (e *Engine) Play(song SongInfo) error {
	slog.Debug("Play called", "songId", song.ID, "title", song.Title)

	if !e.isInitialized {
		slog.Debug("Engine not initialized, initializing now")
		if err := e.Initialize(); err != nil {
			return err
		}
	}

	// Fade out if playing
	if e.IsPlaying() {
		slog.Debug("Fading out current playback")
		e.fadeVolume(e.currentVolume, 0, 50*time.Millisecond)
	}

	// Store as 1-item playlist
	e.mu.Lock()
	e.playlist = []SongInfo{song}
	e.mu.Unlock()

	// Get playback URL
	url, cached := e.getPlaybackURL(song)

	// Load and play
	slog.Debug("Loading file into mpv", "url", url, "cached", cached)
	_, err := e.sendCommand([]interface{}{"loadfile", url, "replace"}, false)
	if err != nil {
		return err
	}

	// Fade in
	slog.Debug("Fading in")
	e.fadeVolume(0, e.currentVolume, 50*time.Millisecond)

	status := "Streaming"
	if cached {
		status = "Playing"
	}
	slog.Info(status, "title", song.Title, "volume", e.currentVolume)
	return nil
}

// LoadPlaylist loads a playlist of songs
func (e *Engine) LoadPlaylist(songs []SongInfo) error {
	if len(songs) == 0 {
		return nil
	}

	if !e.isInitialized {
		if err := e.Initialize(); err != nil {
			return err
		}
	}

	// Fade out if playing
	if e.IsPlaying() {
		e.fadeVolume(e.currentVolume, 0, 50*time.Millisecond)
	}

	// Store playlist
	e.mu.Lock()
	e.playlist = make([]SongInfo, len(songs))
	copy(e.playlist, songs)
	e.mu.Unlock()

	// Get first song's URL
	firstURL, firstCached := e.getPlaybackURL(songs[0])

	// Load first song
	_, err := e.sendCommand([]interface{}{"loadfile", firstURL, "replace"}, false)
	if err != nil {
		return err
	}

	// Prefetch all songs in background
	if e.cache != nil {
		items := make([]CacheItem, len(songs))
		for i, s := range songs {
			items[i] = CacheItem{SongID: s.ID, StreamURL: s.StreamURL}
		}
		go e.cache.Prefetch(items)
	}

	// Queue rest of playlist
	for i := 1; i < len(songs); i++ {
		url, _ := e.getPlaybackURL(songs[i])
		_, _ = e.sendCommand([]interface{}{"loadfile", url, "append"}, false)
	}

	// Fade in
	e.fadeVolume(0, e.currentVolume, 50*time.Millisecond)

	status := "streaming"
	if firstCached {
		status = "cached"
	}
	slog.Info("Loaded playlist", "songs", len(songs), "status", status, "volume", e.currentVolume)
	return nil
}

// GetCurrentSong returns the currently playing song
func (e *Engine) GetCurrentSong() *SongInfo {
	e.mu.Lock()
	playlistLen := len(e.playlist)
	playlist := e.playlist
	e.mu.Unlock()

	if playlistLen == 0 {
		return nil
	}

	position := e.getPlaylistPosition()
	if position < 0 || position >= playlistLen {
		return nil
	}
	return &playlist[position]
}

// GetPlaylist returns the current playlist
func (e *Engine) GetPlaylist() []SongInfo {
	e.mu.Lock()
	defer e.mu.Unlock()
	result := make([]SongInfo, len(e.playlist))
	copy(result, e.playlist)
	return result
}

// GetStatus returns the current player status
func (e *Engine) GetStatus() PlayerStatus {
	e.mu.Lock()
	playlistLen := len(e.playlist)
	e.mu.Unlock()

	currentSong := e.GetCurrentSong()
	position := e.getPlaylistPosition()

	var playlistPosition *string
	if playlistLen > 1 {
		pos := fmt.Sprintf("%d/%d", position+1, playlistLen)
		playlistPosition = &pos
	}

	return PlayerStatus{
		CurrentSong:      currentSong,
		IsPlaying:        e.IsPlaying(),
		PlaylistPosition: playlistPosition,
		Volume:           e.currentVolume,
	}
}

// getPlaylistPosition returns the current playlist position (0-indexed)
func (e *Engine) getPlaylistPosition() int {
	if !e.isInitialized {
		return 0
	}

	resp, err := e.sendCommand([]interface{}{"get_property", "playlist-pos"}, true)
	if err != nil {
		return 0
	}

	if resp != nil && resp.Data != nil {
		if pos, ok := resp.Data.(float64); ok {
			return int(pos)
		}
	}
	return 0
}

// Stop stops playback and clears the playlist
func (e *Engine) Stop() error {
	if !e.isInitialized {
		return nil
	}

	// Fade out
	if e.IsPlaying() {
		e.fadeVolume(e.currentVolume, 0, 50*time.Millisecond)
	}

	_, _ = e.sendCommand([]interface{}{"stop"}, false)
	_, _ = e.sendCommand([]interface{}{"set_property", "volume", float64(e.currentVolume)}, false)

	e.mu.Lock()
	e.playlist = nil
	e.mu.Unlock()

	slog.Info("Stopped")
	return nil
}

// IsPlaying returns true if audio is playing (not idle, not paused)
func (e *Engine) IsPlaying() bool {
	if !e.isInitialized {
		return false
	}

	// Check core-idle
	idleResp, err := e.sendCommand([]interface{}{"get_property", "core-idle"}, true)
	if err != nil {
		return false
	}
	isIdle := true
	if idleResp != nil && idleResp.Data != nil {
		if b, ok := idleResp.Data.(bool); ok {
			isIdle = b
		}
	}

	// Check pause
	pauseResp, err := e.sendCommand([]interface{}{"get_property", "pause"}, true)
	if err != nil {
		return false
	}
	isPaused := false
	if pauseResp != nil && pauseResp.Data != nil {
		if b, ok := pauseResp.Data.(bool); ok {
			isPaused = b
		}
	}

	return !isIdle && !isPaused
}

// fadeVolume smoothly transitions volume
func (e *Engine) fadeVolume(from, to int, duration time.Duration) {
	steps := 10
	stepDuration := duration / time.Duration(steps)
	volumeStep := float64(to-from) / float64(steps)

	for i := 1; i <= steps; i++ {
		volume := float64(from) + volumeStep*float64(i)
		_, _ = e.sendCommand([]interface{}{"set_property", "volume", volume}, false)
		time.Sleep(stepDuration)
	}
}

// Pause pauses playback with fade-out
func (e *Engine) Pause() error {
	if !e.isInitialized {
		return nil
	}

	if e.IsPlaying() {
		e.fadeVolume(e.currentVolume, 0, 100*time.Millisecond)
		_, _ = e.sendCommand([]interface{}{"set_property", "pause", true}, false)
		slog.Info("Paused")
	}
	return nil
}

// Resume resumes playback with fade-in
func (e *Engine) Resume() error {
	if !e.isInitialized {
		return nil
	}

	if e.IsPlaying() {
		slog.Warn("Already playing")
		return nil
	}

	currentSong := e.GetCurrentSong()
	if currentSong == nil {
		slog.Warn("No song to play")
		return nil
	}

	_, _ = e.sendCommand([]interface{}{"set_property", "volume", float64(0)}, false)
	_, _ = e.sendCommand([]interface{}{"set_property", "pause", false}, false)
	e.fadeVolume(0, e.currentVolume, 100*time.Millisecond)
	slog.Info("Playing", "title", currentSong.Title)
	return nil
}

// TogglePlayPause toggles between play and pause
func (e *Engine) TogglePlayPause() error {
	if !e.isInitialized {
		return nil
	}

	if e.IsPlaying() {
		return e.Pause()
	}
	return e.Resume()
}

// Next skips to the next track
func (e *Engine) Next() error {
	if !e.isInitialized {
		return nil
	}

	e.mu.Lock()
	playlistLen := len(e.playlist)
	e.mu.Unlock()

	if playlistLen > 1 {
		_, _ = e.sendCommand([]interface{}{"playlist-next"}, false)
		// Give mpv a moment to update
		time.Sleep(50 * time.Millisecond)
		if song := e.GetCurrentSong(); song != nil {
			slog.Info("Next", "title", song.Title)
		}
	} else {
		slog.Warn("No playlist loaded")
	}
	return nil
}

// Previous goes to the previous track
func (e *Engine) Previous() error {
	if !e.isInitialized {
		return nil
	}

	e.mu.Lock()
	playlistLen := len(e.playlist)
	e.mu.Unlock()

	if playlistLen > 1 {
		_, _ = e.sendCommand([]interface{}{"playlist-prev"}, false)
		// Give mpv a moment to update
		time.Sleep(50 * time.Millisecond)
		if song := e.GetCurrentSong(); song != nil {
			slog.Info("Previous", "title", song.Title)
		}
	} else {
		slog.Warn("No playlist loaded")
	}
	return nil
}

// OnComplete registers a completion callback
func (e *Engine) OnComplete(callback CompletionCallback) {
	e.mu.Lock()
	e.completionCallbacks = append(e.completionCallbacks, callback)
	e.mu.Unlock()
}

// setMpvVolume sets the mpv volume
func (e *Engine) setMpvVolume(percent int) error {
	if !e.isInitialized {
		return nil
	}
	_, err := e.sendCommand([]interface{}{"set_property", "volume", float64(percent)}, false)
	return err
}

// SetVolume sets the volume level
func (e *Engine) SetVolume(percent int) error {
	percent = max(0, min(100, percent))

	e.mu.Lock()
	e.currentVolume = percent
	e.mu.Unlock()

	if e.isInitialized {
		_ = e.setMpvVolume(percent)
		slog.Info("Volume", "level", percent)
	}
	return nil
}

// GetVolume returns the current volume
func (e *Engine) GetVolume() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.currentVolume
}

// VolumeUp increases volume
func (e *Engine) VolumeUp(amount int) error {
	e.mu.Lock()
	newVol := e.currentVolume + amount
	e.mu.Unlock()
	return e.SetVolume(newVol)
}

// VolumeDown decreases volume
func (e *Engine) VolumeDown(amount int) error {
	e.mu.Lock()
	newVol := e.currentVolume - amount
	e.mu.Unlock()
	return e.SetVolume(newVol)
}

// InitializeTones initializes the tone generator
func (e *Engine) InitializeTones() error {
	return e.toneGenerator.Initialize()
}

// PlayStartupChime plays the startup chime
func (e *Engine) PlayStartupChime() {
	e.toneGenerator.PlayStartup()
}

// PlayCardBeep plays the card recognition beep
func (e *Engine) PlayCardBeep() {
	e.toneGenerator.PlayCard()
}

// PlayErrorBeep plays the error beep
func (e *Engine) PlayErrorBeep() {
	e.toneGenerator.PlayError()
}

// Shutdown shuts down the audio engine
func (e *Engine) Shutdown() error {
	close(e.done)

	if e.ipcConn != nil {
		_, _ = e.sendCommand([]interface{}{"quit"}, false)
		e.ipcConn.Close()
		e.ipcConn = nil
	}

	if e.mpvCmd != nil && e.mpvCmd.Process != nil {
		_ = e.mpvCmd.Process.Kill()
		e.mpvCmd = nil
	}

	if _, err := os.Stat(ipcPath); err == nil {
		os.Remove(ipcPath)
	}

	e.mu.Lock()
	e.isInitialized = false
	e.mu.Unlock()

	return nil
}
