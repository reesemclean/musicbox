/**
 * MP3 frame-level parsing.
 *
 * Used to build a continuous multi-track stream (see the playlist stream
 * endpoint): the decoder must receive one unbroken sequence of audio frames so
 * that crossing a track boundary costs nothing.
 *
 * Appending whole files nearly works — MP3 is self-framing — but leaves three
 * kinds of non-audio bytes mid-stream:
 *   - ID3v2 headers at the start of each file
 *   - ID3v1 (128-byte) trailers at the end
 *   - Xing/Info/LAME VBR header frames, which are structurally valid frames
 *     that decode to silence
 * The first two force the decoder to resync; the third injects an audible gap.
 * Measured over three 3.03s tracks, appending files whole decoded ~25ms short
 * and made ffmpeg report a malformed stream, while frame extraction was
 * sample-exact. See docs/decisions/2026-08-02-playlist-streaming.md.
 */

/** Bitrate table (kbps) for MPEG1 Layer III. */
const BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
]
/** Bitrate table (kbps) for MPEG2/2.5 Layer III. */
const BITRATES_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
]
/** Sample rates by version bits: 3=MPEG1, 2=MPEG2, 0=MPEG2.5. */
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
}

export interface FrameInfo {
  offset: number
  length: number
  sampleRate: number
  channels: number
  bitrate: number
  samplesPerFrame: number
}

/** Parse an MP3 frame header at `offset`, or null if it isn't a valid frame. */
export function parseFrameHeader(buf: Buffer, offset: number): FrameInfo | null {
  if (offset + 4 > buf.length) return null

  // Sync word: 11 bits set.
  if (buf[offset] !== 0xff || (buf[offset + 1] & 0xe0) !== 0xe0) return null

  const versionBits = (buf[offset + 1] >> 3) & 0x03
  const layerBits = (buf[offset + 1] >> 1) & 0x03 // 1 = Layer III
  if (versionBits === 1 || layerBits !== 1) return null

  const bitrateIndex = (buf[offset + 2] >> 4) & 0x0f
  const sampleRateIndex = (buf[offset + 2] >> 2) & 0x03
  const padding = (buf[offset + 2] >> 1) & 0x01
  const channelMode = (buf[offset + 3] >> 6) & 0x03

  if (bitrateIndex === 0 || bitrateIndex === 15) return null // free/invalid
  if (sampleRateIndex === 3) return null

  const isV1 = versionBits === 3
  const bitrate =
    (isV1 ? BITRATES_V1_L3[bitrateIndex] : BITRATES_V2_L3[bitrateIndex]) * 1000
  const sampleRate = SAMPLE_RATES[versionBits][sampleRateIndex]
  if (!bitrate || !sampleRate) return null

  const samplesPerFrame = isV1 ? 1152 : 576
  const length =
    Math.floor((samplesPerFrame / 8) * (bitrate / sampleRate)) + padding

  if (length < 4) return null

  return {
    offset,
    length,
    sampleRate,
    channels: channelMode === 3 ? 1 : 2,
    bitrate,
    samplesPerFrame,
  }
}

/** Size of the ID3v2 tag at the start of `buf`, or 0 if there isn't one. */
export function id3v2Size(buf: Buffer): number {
  if (buf.length < 10) return 0
  if (buf.toString('latin1', 0, 3) !== 'ID3') return 0

  // Syncsafe integer: 7 bits per byte.
  const size =
    ((buf[6] & 0x7f) << 21) |
    ((buf[7] & 0x7f) << 14) |
    ((buf[8] & 0x7f) << 7) |
    (buf[9] & 0x7f)

  const footerPresent = (buf[5] & 0x10) !== 0
  return 10 + size + (footerPresent ? 10 : 0)
}

/**
 * Is this frame a Xing/Info/VBRI header rather than real audio?
 * These sit in the first frame of many encoders' output and decode as silence.
 */
function isVbrHeaderFrame(buf: Buffer, frame: FrameInfo): boolean {
  const end = Math.min(frame.offset + frame.length, buf.length)
  const window = buf.toString('latin1', frame.offset, end)
  return (
    window.includes('Xing') || window.includes('Info') || window.includes('VBRI')
  )
}

export interface AudioProfile {
  /** Total bytes of decodable audio frames — excludes ID3 and VBR headers. */
  audioBytes: number
  /** Duration derived from frame count, exact rather than estimated. */
  durationSec: number
  sampleRate: number
  channels: number
  frameCount: number
}

export interface ExtractedAudio extends AudioProfile {
  /** Audio frames only, ready to concatenate with another track's. */
  audio: Buffer
}

/**
 * Walk a file's frames, optionally collecting them.
 *
 * `collect: false` measures without allocating — used at ingest, where only the
 * profile is stored.
 */
function walkFrames(file: Buffer, collect: boolean): ExtractedAudio {
  let pos = id3v2Size(file)

  // Drop an ID3v1 trailer so it doesn't land mid-stream.
  let end = file.length
  if (end >= 128 && file.toString('latin1', end - 128, end - 125) === 'TAG') {
    end -= 128
  }

  const chunks: Buffer[] = []
  let audioBytes = 0
  let frameCount = 0
  let totalSamples = 0
  let sampleRate = 0
  let channels = 0
  let skippedVbrHeader = false

  while (pos < end) {
    const frame = parseFrameHeader(file, pos)

    if (!frame) {
      // Not a frame boundary — scan forward for the next sync word.
      pos++
      continue
    }

    if (frame.offset + frame.length > end) break

    if (!skippedVbrHeader && isVbrHeaderFrame(file, frame)) {
      skippedVbrHeader = true
      pos += frame.length
      continue
    }

    if (!sampleRate) {
      sampleRate = frame.sampleRate
      channels = frame.channels
    }

    if (collect) {
      chunks.push(file.subarray(frame.offset, frame.offset + frame.length))
    }
    audioBytes += frame.length
    totalSamples += frame.samplesPerFrame
    frameCount++
    pos += frame.length
  }

  return {
    audio: collect ? Buffer.concat(chunks) : Buffer.alloc(0),
    audioBytes,
    durationSec: sampleRate ? totalSamples / sampleRate : 0,
    sampleRate,
    channels,
    frameCount,
  }
}

/** Strip container metadata and return only decodable audio frames. */
export function extractAudioFrames(file: Buffer): ExtractedAudio {
  return walkFrames(file, true)
}

/**
 * Measure a file without materialising its audio.
 *
 * Recorded at ingest so the playlist stream can compute an exact
 * Content-Length without reading every file in the playlist first.
 */
export function profileAudio(file: Buffer): AudioProfile {
  const { audio: _audio, ...profile } = walkFrames(file, false)
  return profile
}
