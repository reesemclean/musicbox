package audio

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

const (
	cacheDir       = "/var/cache/musicbox"
	maxCacheSizeMB = 10000 // 10GB cache limit
)

// CacheItem represents a song to be cached
type CacheItem struct {
	SongID    int
	StreamURL string
}

// cacheEntry represents a cached file
type cacheEntry struct {
	songID      int
	filePath    string
	downloading bool
	done        chan struct{} // Closed when download completes
}

// Cache manages local audio file caching
type Cache struct {
	mu          sync.RWMutex
	entries     map[int]*cacheEntry
	initialized bool
}

// NewCache creates a new audio cache
func NewCache() *Cache {
	return &Cache{
		entries: make(map[int]*cacheEntry),
	}
}

// Initialize sets up the cache directory and scans for existing files
func (c *Cache) Initialize() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.initialized {
		return nil
	}

	// Create cache directory
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		slog.Warn("Could not create cache directory", "error", err)
		return nil // Non-fatal
	}

	// Scan existing cached files
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		slog.Warn("Could not scan cache directory", "error", err)
		return nil // Non-fatal
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		ext := filepath.Ext(name)
		if ext == ".mp3" || ext == ".m4a" || ext == ".opus" {
			// Extract song ID from filename (e.g., "123.mp3")
			idStr := strings.TrimSuffix(name, ext)
			if songID, err := strconv.Atoi(idStr); err == nil {
				c.entries[songID] = &cacheEntry{
					songID:      songID,
					filePath:    filepath.Join(cacheDir, name),
					downloading: false,
				}
			}
		}
	}

	slog.Info("Audio cache initialized", "cached", len(c.entries))
	c.initialized = true
	return nil
}

// IsCached returns true if the song is cached and not currently downloading
func (c *Cache) IsCached(songID int) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[songID]
	if !ok || entry.downloading {
		return false
	}

	// Verify file still exists
	if _, err := os.Stat(entry.filePath); err != nil {
		return false
	}
	return true
}

// GetCachedPath returns the cached file path, or empty string if not cached
func (c *Cache) GetCachedPath(songID int) string {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, ok := c.entries[songID]
	if !ok || entry.downloading {
		return ""
	}

	// Verify file exists
	if _, err := os.Stat(entry.filePath); err != nil {
		return ""
	}
	return entry.filePath
}

// GetLocalPath returns the local path for a song, downloading if necessary
func (c *Cache) GetLocalPath(songID int, streamURL string) (string, error) {
	if err := c.Initialize(); err != nil {
		return "", err
	}

	c.mu.RLock()
	entry, ok := c.entries[songID]
	c.mu.RUnlock()

	// Already cached
	if ok && !entry.downloading {
		if _, err := os.Stat(entry.filePath); err == nil {
			return entry.filePath, nil
		}
	}

	// Currently downloading - wait for it
	if ok && entry.downloading && entry.done != nil {
		<-entry.done
		c.mu.RLock()
		entry = c.entries[songID]
		c.mu.RUnlock()
		if entry != nil && !entry.downloading {
			return entry.filePath, nil
		}
		return "", fmt.Errorf("download failed")
	}

	// Need to download
	return c.download(songID, streamURL)
}

// Prefetch downloads songs in the background
func (c *Cache) Prefetch(songs []CacheItem) {
	for _, song := range songs {
		if !c.IsCached(song.SongID) {
			go func(s CacheItem) {
				// Prefetch failures are intentionally ignored
				_, _ = c.download(s.SongID, s.StreamURL)
			}(song)
		}
	}
}

// download downloads a song to the cache
func (c *Cache) download(songID int, streamURL string) (string, error) {
	// Determine file extension from URL
	ext := ".opus" // default
	if parsed, err := url.Parse(streamURL); err == nil {
		if urlExt := filepath.Ext(parsed.Path); urlExt != "" {
			ext = urlExt
		}
	}

	filePath := filepath.Join(cacheDir, fmt.Sprintf("%d%s", songID, ext))
	tempPath := filePath + ".tmp"

	// Create entry to track download
	done := make(chan struct{})
	entry := &cacheEntry{
		songID:      songID,
		filePath:    filePath,
		downloading: true,
		done:        done,
	}

	c.mu.Lock()
	c.entries[songID] = entry
	c.mu.Unlock()

	// Cleanup on failure, signal completion on exit
	var success bool
	defer func() {
		if !success {
			c.downloadFailed(songID)
			os.Remove(tempPath)
		}
		close(done)
	}()

	slog.Info("Caching song", "songId", songID)

	resp, err := http.Get(streamURL) //nolint:gosec // URL is from trusted server
	if err != nil {
		return "", fmt.Errorf("failed to fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// Write to temp file
	file, err := os.Create(tempPath)
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}

	_, err = io.Copy(file, resp.Body)
	file.Close()
	if err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tempPath, filePath); err != nil {
		return "", fmt.Errorf("failed to rename: %w", err)
	}

	// Mark as complete
	c.mu.Lock()
	entry.downloading = false
	c.mu.Unlock()

	success = true
	slog.Info("Cached song", "songId", songID)

	// Cleanup in background
	go c.cleanup()

	return filePath, nil
}

// downloadFailed marks a download as failed
func (c *Cache) downloadFailed(songID int) {
	c.mu.Lock()
	delete(c.entries, songID)
	c.mu.Unlock()
}

// cleanup removes old files if cache is over the limit
func (c *Cache) cleanup() {
	c.mu.RLock()
	if !c.initialized {
		c.mu.RUnlock()
		return
	}
	c.mu.RUnlock()

	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		return
	}

	type fileInfo struct {
		name  string
		path  string
		size  int64
		mtime int64
	}

	var files []fileInfo
	var totalSize int64

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		path := filepath.Join(cacheDir, entry.Name())
		files = append(files, fileInfo{
			name:  entry.Name(),
			path:  path,
			size:  info.Size(),
			mtime: info.ModTime().UnixNano(),
		})
		totalSize += info.Size()
	}

	maxBytes := int64(maxCacheSizeMB) * 1024 * 1024
	if totalSize <= maxBytes {
		return
	}

	// Sort by oldest first
	sort.Slice(files, func(i, j int) bool {
		return files[i].mtime < files[j].mtime
	})

	// Delete oldest until under 80% capacity
	targetSize := int64(float64(maxBytes) * 0.8)
	for _, f := range files {
		if totalSize <= targetSize {
			break
		}

		if err := os.Remove(f.path); err == nil {
			totalSize -= f.size

			// Remove from cache map
			idStr := strings.TrimSuffix(f.name, filepath.Ext(f.name))
			if songID, err := strconv.Atoi(idStr); err == nil {
				c.mu.Lock()
				delete(c.entries, songID)
				c.mu.Unlock()
			}
		}
	}

	slog.Info("Cache cleanup complete")
}
