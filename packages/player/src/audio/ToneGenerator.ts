/**
 * ToneGenerator - Generates WAV files for UI tones at startup
 *
 * Pre-generates tones with proper fade envelopes to prevent pops.
 * Uses aplay for playback which works with ALSA dmix for mixing.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { spawn } from 'child_process'

interface ToneSpec {
  name: string
  frequencies: number[] // Frequencies to play in sequence
  durations: number[] // Duration of each tone in ms
  gaps: number[] // Gap after each tone in ms
  volume: number // 0.0 to 1.0
}

const SAMPLE_RATE = 44100
const FADE_MS = 10 // 10ms fade in/out to prevent pops
const TONE_DIR = '/tmp/musicbox-tones'

export class ToneGenerator {
  private tones: Map<string, string> = new Map() // name -> file path
  private initialized = false

  /**
   * Generate all tone WAV files
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create tone directory
    if (!existsSync(TONE_DIR)) {
      mkdirSync(TONE_DIR, { recursive: true })
    }

    // Define tones
    const toneSpecs: ToneSpec[] = [
      {
        name: 'startup',
        // C major arpeggio: C5, E5, G5, C6
        frequencies: [523, 659, 784, 1047],
        durations: [120, 120, 120, 200],
        gaps: [30, 30, 30, 0],
        volume: 0.1,
      },
      {
        name: 'card',
        // Quick double-beep: A5, C#6
        frequencies: [880, 1100],
        durations: [80, 80],
        gaps: [50, 0],
        volume: 0.1,
      },
      {
        name: 'error',
        // Low descending: ~400Hz, ~300Hz
        frequencies: [400, 300],
        durations: [150, 200],
        gaps: [50, 0],
        volume: 0.1,
      },
    ]

    // Generate each tone
    for (const spec of toneSpecs) {
      const filePath = `${TONE_DIR}/${spec.name}.wav`
      this.generateToneSequence(spec, filePath)
      this.tones.set(spec.name, filePath)
    }

    this.initialized = true
    console.log('   🔔 Tone files generated')
  }

  /**
   * Generate a WAV file with a sequence of tones
   */
  private generateToneSequence(spec: ToneSpec, filePath: string): void {
    const samples: number[] = []

    for (let i = 0; i < spec.frequencies.length; i++) {
      const freq = spec.frequencies[i]
      const durationMs = spec.durations[i]
      const gapMs = spec.gaps[i]

      // Generate tone with fade envelope
      const toneSamples = this.generateTone(freq, durationMs, spec.volume)
      samples.push(...toneSamples)

      // Add gap (silence)
      if (gapMs > 0) {
        const gapSamples = Math.floor((gapMs / 1000) * SAMPLE_RATE)
        for (let j = 0; j < gapSamples; j++) {
          samples.push(0)
        }
      }
    }

    // Write WAV file
    this.writeWav(filePath, samples)
  }

  /**
   * Generate a single tone with fade envelope
   */
  private generateTone(
    frequency: number,
    durationMs: number,
    volume: number,
  ): number[] {
    const numSamples = Math.floor((durationMs / 1000) * SAMPLE_RATE)
    const fadeSamples = Math.floor((FADE_MS / 1000) * SAMPLE_RATE)
    const samples: number[] = []

    for (let i = 0; i < numSamples; i++) {
      // Generate sine wave
      const t = i / SAMPLE_RATE
      let sample = Math.sin(2 * Math.PI * frequency * t) * volume

      // Apply fade envelope
      if (i < fadeSamples) {
        // Fade in
        sample *= i / fadeSamples
      } else if (i > numSamples - fadeSamples) {
        // Fade out
        sample *= (numSamples - i) / fadeSamples
      }

      samples.push(sample)
    }

    return samples
  }

  /**
   * Write samples to a WAV file (16-bit mono)
   */
  private writeWav(filePath: string, samples: number[]): void {
    const numSamples = samples.length
    const byteRate = SAMPLE_RATE * 2 // 16-bit = 2 bytes per sample
    const dataSize = numSamples * 2
    const fileSize = 36 + dataSize

    const buffer = Buffer.alloc(44 + dataSize)
    let offset = 0

    // RIFF header
    buffer.write('RIFF', offset)
    offset += 4
    buffer.writeUInt32LE(fileSize, offset)
    offset += 4
    buffer.write('WAVE', offset)
    offset += 4

    // fmt chunk
    buffer.write('fmt ', offset)
    offset += 4
    buffer.writeUInt32LE(16, offset)
    offset += 4 // Chunk size
    buffer.writeUInt16LE(1, offset)
    offset += 2 // Audio format (PCM)
    buffer.writeUInt16LE(1, offset)
    offset += 2 // Num channels (mono)
    buffer.writeUInt32LE(SAMPLE_RATE, offset)
    offset += 4
    buffer.writeUInt32LE(byteRate, offset)
    offset += 4
    buffer.writeUInt16LE(2, offset)
    offset += 2 // Block align
    buffer.writeUInt16LE(16, offset)
    offset += 2 // Bits per sample

    // data chunk
    buffer.write('data', offset)
    offset += 4
    buffer.writeUInt32LE(dataSize, offset)
    offset += 4

    // Write samples
    for (const sample of samples) {
      // Convert float [-1, 1] to 16-bit signed integer
      const intSample = Math.max(
        -32768,
        Math.min(32767, Math.floor(sample * 32767)),
      )
      buffer.writeInt16LE(intSample, offset)
      offset += 2
    }

    writeFileSync(filePath, buffer)
  }

  /**
   * Play a pre-generated tone using aplay
   */
  play(name: string): void {
    const filePath = this.tones.get(name)
    if (!filePath) {
      console.log(`   ⚠️  Unknown tone: ${name}`)
      return
    }

    // Fire and forget - don't wait for playback to complete
    const proc = spawn('aplay', ['-q', filePath], { stdio: 'ignore' })
    proc.on('error', () => {
      // Ignore errors - tone playback is non-critical
    })
  }

  /**
   * Play startup chime
   */
  playStartup(): void {
    this.play('startup')
  }

  /**
   * Play card recognition beep
   */
  playCard(): void {
    this.play('card')
  }

  /**
   * Play error beep
   */
  playError(): void {
    this.play('error')
  }
}
