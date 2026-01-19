package audio

import (
	"bufio"
	"encoding/binary"
	"log/slog"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

const (
	sampleRate = 44100
	fadeMs     = 10 // 10ms fade in/out to prevent pops
	toneDir    = "/tmp/musicbox-tones"
)

// toneSpec defines a tone to generate
type toneSpec struct {
	name        string
	frequencies []float64
	durations   []int // ms
	gaps        []int // ms
	volume      float64
}

// ToneGenerator generates and plays WAV tones
type ToneGenerator struct {
	mu          sync.Mutex
	tones       map[string]string // name -> file path
	initialized bool
}

// NewToneGenerator creates a new tone generator
func NewToneGenerator() *ToneGenerator {
	return &ToneGenerator{
		tones: make(map[string]string),
	}
}

// Initialize generates all tone WAV files
func (t *ToneGenerator) Initialize() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.initialized {
		return nil
	}

	// Create tone directory
	if err := os.MkdirAll(toneDir, 0o755); err != nil {
		slog.Warn("Could not create tone directory", "error", err)
		return nil // Non-fatal
	}

	// Define tones
	specs := []toneSpec{
		{
			name:        "startup",
			frequencies: []float64{523, 659, 784, 1047}, // C major arpeggio
			durations:   []int{120, 120, 120, 200},
			gaps:        []int{30, 30, 30, 0},
			volume:      0.1,
		},
		{
			name:        "card",
			frequencies: []float64{880, 1100}, // Quick double-beep
			durations:   []int{80, 80},
			gaps:        []int{50, 0},
			volume:      0.1,
		},
		{
			name:        "error",
			frequencies: []float64{400, 300}, // Descending
			durations:   []int{150, 200},
			gaps:        []int{50, 0},
			volume:      0.1,
		},
	}

	// Generate each tone
	for _, spec := range specs {
		filePath := filepath.Join(toneDir, spec.name+".wav")
		if err := t.generateToneSequence(spec, filePath); err != nil {
			slog.Warn("Failed to generate tone", "name", spec.name, "error", err)
			continue
		}
		t.tones[spec.name] = filePath
	}

	t.initialized = true
	slog.Info("Tone files generated")
	return nil
}

// generateToneSequence generates a WAV file with a sequence of tones
func (t *ToneGenerator) generateToneSequence(spec toneSpec, filePath string) error {
	// Estimate total samples for pre-allocation
	totalMs := 0
	for i, dur := range spec.durations {
		totalMs += dur
		if i < len(spec.gaps) {
			totalMs += spec.gaps[i]
		}
	}
	samples := make([]float64, 0, totalMs*sampleRate/1000)

	for i, freq := range spec.frequencies {
		duration := spec.durations[i]
		gap := 0
		if i < len(spec.gaps) {
			gap = spec.gaps[i]
		}

		// Generate tone with fade envelope
		toneSamples := t.generateTone(freq, duration, spec.volume)
		samples = append(samples, toneSamples...)

		// Add gap (silence)
		if gap > 0 {
			gapSamples := gap * sampleRate / 1000
			samples = append(samples, make([]float64, gapSamples)...)
		}
	}

	return t.writeWav(filePath, samples)
}

// generateTone generates a single tone with fade envelope
func (t *ToneGenerator) generateTone(frequency float64, durationMs int, volume float64) []float64 {
	numSamples := durationMs * sampleRate / 1000
	fadeSamples := fadeMs * sampleRate / 1000
	samples := make([]float64, numSamples)

	for i := range samples {
		// Generate sine wave
		sample := math.Sin(2*math.Pi*frequency*float64(i)/sampleRate) * volume

		// Apply fade envelope
		if i < fadeSamples {
			sample *= float64(i) / float64(fadeSamples)
		} else if i > numSamples-fadeSamples {
			sample *= float64(numSamples-i) / float64(fadeSamples)
		}

		samples[i] = sample
	}

	return samples
}

// writeWav writes samples to a WAV file (16-bit mono)
func (t *ToneGenerator) writeWav(filePath string, samples []float64) error {
	numSamples := len(samples)
	byteRate := sampleRate * 2         // 16-bit = 2 bytes per sample
	dataSize := uint32(numSamples * 2) //nolint:gosec // Size is bounded by tone duration
	fileSize := 36 + dataSize

	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	w := bufio.NewWriter(file)

	// RIFF header
	_, _ = w.WriteString("RIFF")
	_ = binary.Write(w, binary.LittleEndian, fileSize)
	_, _ = w.WriteString("WAVE")

	// fmt chunk
	_, _ = w.WriteString("fmt ")
	_ = binary.Write(w, binary.LittleEndian, uint32(16)) // Chunk size
	_ = binary.Write(w, binary.LittleEndian, uint16(1))  // Audio format (PCM)
	_ = binary.Write(w, binary.LittleEndian, uint16(1))  // Num channels (mono)
	_ = binary.Write(w, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(w, binary.LittleEndian, uint32(byteRate))
	_ = binary.Write(w, binary.LittleEndian, uint16(2))  // Block align
	_ = binary.Write(w, binary.LittleEndian, uint16(16)) // Bits per sample

	// data chunk
	_, _ = w.WriteString("data")
	_ = binary.Write(w, binary.LittleEndian, dataSize)

	// Write samples - clamp to 16-bit range
	for _, sample := range samples {
		intSample := int16(max(-32768, min(32767, sample*32767)))
		_ = binary.Write(w, binary.LittleEndian, intSample)
	}

	return w.Flush()
}

// play plays a pre-generated tone using aplay
func (t *ToneGenerator) play(name string) {
	t.mu.Lock()
	filePath, ok := t.tones[name]
	t.mu.Unlock()

	if !ok {
		slog.Warn("Unknown tone", "name", name)
		return
	}

	// Fire and forget
	cmd := exec.Command("aplay", "-q", filePath)
	_ = cmd.Start()
}

// PlayStartup plays the startup chime
func (t *ToneGenerator) PlayStartup() {
	t.play("startup")
}

// PlayCard plays the card recognition beep
func (t *ToneGenerator) PlayCard() {
	t.play("card")
}

// PlayError plays the error beep
func (t *ToneGenerator) PlayError() {
	t.play("error")
}
