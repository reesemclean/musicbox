// Package api provides HTTP client functionality for the MusicBox server
package api

// ContentType represents the type of content mapped to an NFC card
type ContentType string

const (
	ContentTypeSong     ContentType = "song"
	ContentTypePlaylist ContentType = "playlist"
	ContentTypeAction   ContentType = "action"
	ContentTypePodcast  ContentType = "podcast"
)

// Action represents a playback action
type Action string

const (
	ActionPlay     Action = "play"
	ActionPause    Action = "pause"
	ActionNext     Action = "next"
	ActionPrevious Action = "previous"
	ActionStop     Action = "stop"
)

// SongContent represents a song in API responses
type SongContent struct {
	ID       int     `json:"id"`
	Title    string  `json:"title"`
	Artist   *string `json:"artist"`
	Album    *string `json:"album"`
	Duration *int    `json:"duration"`
	MimeType string  `json:"mimeType"`
	FileSize int64   `json:"fileSize"`
}

// PlaylistSong represents a song within a playlist
type PlaylistSong struct {
	Position int     `json:"position"`
	ID       int     `json:"id"`
	Title    string  `json:"title"`
	Artist   *string `json:"artist"`
	Album    *string `json:"album"`
	Duration *int    `json:"duration"`
	MimeType string  `json:"mimeType"`
	FileSize int64   `json:"fileSize"`
}

// PlaylistContent represents a playlist in API responses
type PlaylistContent struct {
	ID        int            `json:"id"`
	Name      string         `json:"name"`
	CreatedAt *string        `json:"createdAt"`
	UpdatedAt *string        `json:"updatedAt"`
	Songs     []PlaylistSong `json:"songs"`
}

// EpisodeContent represents a podcast episode
type EpisodeContent struct {
	ID             int     `json:"id"`
	FeedID         int     `json:"feedId"`
	Title          string  `json:"title"`
	Description    *string `json:"description"`
	Duration       *int    `json:"duration"`
	PublishedAt    *string `json:"publishedAt"`
	MimeType       *string `json:"mimeType"`
	FileSize       *int64  `json:"fileSize"`
	DownloadStatus string  `json:"downloadStatus"`
}

// PodcastContent represents a podcast feed
type PodcastContent struct {
	ID            int             `json:"id"`
	Title         string          `json:"title"`
	Description   *string         `json:"description"`
	ImageURL      *string         `json:"imageUrl"`
	Author        *string         `json:"author"`
	LatestEpisode *EpisodeContent `json:"latestEpisode"`
}

// NFCScanRequest is the request body for scanning an NFC card
type NFCScanRequest struct {
	Secret string `json:"secret"`
	NFCID  string `json:"nfcId"`
}

// NFCScanResponse represents the server response for an NFC scan
type NFCScanResponse struct {
	Success     bool        `json:"success"`
	NFCID       string      `json:"nfcId"`
	ContentType ContentType `json:"contentType"`
	Content     *Content    `json:"content"`
}

// Content holds the actual content based on content type
// Only one of the fields will be populated
type Content struct {
	Type     string           `json:"type"`
	Song     *SongContent     `json:"song,omitempty"`
	Playlist *PlaylistContent `json:"playlist,omitempty"`
	Action   *Action          `json:"action,omitempty"`
	Podcast  *PodcastContent  `json:"podcast,omitempty"`
}

// NFCScanErrorResponse represents an error response from the server
type NFCScanErrorResponse struct {
	Error string `json:"error"`
	NFCID string `json:"nfcId,omitempty"`
}

// HeartbeatRequest is the request body for sending a heartbeat
type HeartbeatRequest struct {
	Secret        string             `json:"secret"`
	IPAddress     string             `json:"ipAddress"`
	CurrentSong   *HeartbeatSongInfo `json:"currentSong,omitempty"`
	PlayerVersion string             `json:"playerVersion,omitempty"`
}

// HeartbeatSongInfo contains song info for heartbeat requests
type HeartbeatSongInfo struct {
	Title     string  `json:"title"`
	Artist    *string `json:"artist,omitempty"`
	IsPlaying bool    `json:"isPlaying"`
}

// HeartbeatResponse represents the server response for a heartbeat
type HeartbeatResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
}

// SoundMachineConfig represents the sound machine configuration
type SoundMachineConfig struct {
	SoundName string `json:"soundName"`
	StreamURL string `json:"streamUrl"`
}
