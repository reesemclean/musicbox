package triggers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// HTTPTrigger provides HTTP API for remote control
type HTTPTrigger struct {
	port   int
	server *http.Server
	player PlayerController
}

// NewHTTPTrigger creates a new HTTP trigger
func NewHTTPTrigger(port int) *HTTPTrigger {
	return &HTTPTrigger{
		port: port,
	}
}

// Name returns the trigger name
func (h *HTTPTrigger) Name() string {
	return "http"
}

// Start starts the HTTP server
func (h *HTTPTrigger) Start(player PlayerController) error {
	h.player = player

	mux := http.NewServeMux()

	// Register handlers
	mux.HandleFunc("/scan", h.handleScan)
	mux.HandleFunc("/play", h.handlePlay)
	mux.HandleFunc("/pause", h.handlePause)
	mux.HandleFunc("/next", h.handleNext)
	mux.HandleFunc("/previous", h.handlePrevious)
	mux.HandleFunc("/stop", h.handleStop)
	mux.HandleFunc("/volume", h.handleVolume)
	mux.HandleFunc("/volume/up", h.handleVolumeUp)
	mux.HandleFunc("/volume/down", h.handleVolumeDown)
	mux.HandleFunc("/status", h.handleStatus)

	h.server = &http.Server{
		Addr:              fmt.Sprintf(":%d", h.port),
		Handler:           h.corsMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		if err := h.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
		}
	}()

	slog.Info("HTTP trigger listening", "port", h.port)
	return nil
}

// Stop stops the HTTP server
func (h *HTTPTrigger) Stop() error {
	if h.server == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := h.server.Shutdown(ctx)
	slog.Info("HTTP trigger stopped")
	return err
}

// corsMiddleware adds CORS headers to responses
func (h *HTTPTrigger) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Content-Type", "application/json")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (h *HTTPTrigger) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (h *HTTPTrigger) writeError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, map[string]string{"error": message})
}

func (h *HTTPTrigger) writeSuccess(w http.ResponseWriter, data map[string]interface{}) {
	if data == nil {
		data = make(map[string]interface{})
	}
	data["success"] = true
	h.writeJSON(w, http.StatusOK, data)
}

func (h *HTTPTrigger) handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req struct {
		NFCID string `json:"nfcId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if req.NFCID == "" {
		h.writeError(w, http.StatusBadRequest, "Missing nfcId parameter")
		return
	}

	if err := h.player.HandleCardScan(req.NFCID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handlePlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	slog.Info("HTTP: /play")
	_ = h.player.Play()
	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handlePause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	slog.Info("HTTP: /pause")
	_ = h.player.Pause()
	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handleNext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	_ = h.player.Next()
	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handlePrevious(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	_ = h.player.Previous()
	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	slog.Info("HTTP: /stop")
	_ = h.player.Stop()
	h.writeSuccess(w, nil)
}

func (h *HTTPTrigger) handleVolume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req struct {
		Level *int `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if req.Level == nil {
		h.writeError(w, http.StatusBadRequest, "Missing or invalid level parameter (0-100)")
		return
	}

	_ = h.player.SetVolume(*req.Level)
	h.writeSuccess(w, map[string]interface{}{"volume": *req.Level})
}

func (h *HTTPTrigger) handleVolumeUp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	_ = h.player.VolumeUp()
	h.writeSuccess(w, map[string]interface{}{"volume": h.player.GetVolume()})
}

func (h *HTTPTrigger) handleVolumeDown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	_ = h.player.VolumeDown()
	h.writeSuccess(w, map[string]interface{}{"volume": h.player.GetVolume()})
}

func (h *HTTPTrigger) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	statusJSON, err := h.player.GetStatusJSON()
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(statusJSON)
}
