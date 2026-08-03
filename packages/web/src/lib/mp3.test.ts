import { describe, expect, it } from 'vitest'
import { extractAudioFrames, id3v2Size, parseFrameHeader, profileAudio } from './mp3'

/**
 * Build a synthetic MPEG1 Layer III frame header.
 * 128kbps / 44.1kHz / mono gives a 417-byte frame (no padding).
 */
function frameHeader({
  bitrateIndex = 9, // 128kbps
  sampleRateIndex = 0, // 44100
  padding = 0,
  channelMode = 3, // mono
} = {}): Buffer {
  const h = Buffer.alloc(4)
  h[0] = 0xff
  h[1] = 0xfb // MPEG1, Layer III, no CRC
  h[2] = (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1)
  h[3] = channelMode << 6
  return h
}

/** A frame header followed by `length - 4` bytes of filler. */
function frame(length: number, opts?: Parameters<typeof frameHeader>[0]): Buffer {
  return Buffer.concat([frameHeader(opts), Buffer.alloc(length - 4, 0x55)])
}

function id3v2(payloadSize: number): Buffer {
  const tag = Buffer.alloc(10 + payloadSize)
  tag.write('ID3', 0, 'latin1')
  tag[3] = 3 // version
  // Syncsafe size across bytes 6..9
  tag[6] = (payloadSize >> 21) & 0x7f
  tag[7] = (payloadSize >> 14) & 0x7f
  tag[8] = (payloadSize >> 7) & 0x7f
  tag[9] = payloadSize & 0x7f
  return tag
}

describe('parseFrameHeader', () => {
  it('parses a 128kbps 44.1kHz mono frame', () => {
    const info = parseFrameHeader(frameHeader(), 0)
    expect(info).not.toBeNull()
    expect(info!.bitrate).toBe(128000)
    expect(info!.sampleRate).toBe(44100)
    expect(info!.channels).toBe(1)
    expect(info!.samplesPerFrame).toBe(1152)
    expect(info!.length).toBe(417)
  })

  it('accounts for the padding bit', () => {
    expect(parseFrameHeader(frameHeader({ padding: 1 }), 0)!.length).toBe(418)
  })

  it('reports stereo modes as 2 channels', () => {
    for (const mode of [0, 1, 2]) {
      expect(parseFrameHeader(frameHeader({ channelMode: mode }), 0)!.channels).toBe(2)
    }
  })

  it('rejects non-frames', () => {
    expect(parseFrameHeader(Buffer.from([0x00, 0x00, 0x00, 0x00]), 0)).toBeNull()
    // Missing sync bits
    expect(parseFrameHeader(Buffer.from([0xff, 0x0b, 0x90, 0x00]), 0)).toBeNull()
    // Truncated
    expect(parseFrameHeader(Buffer.from([0xff, 0xfb]), 0)).toBeNull()
  })

  it('rejects reserved bitrate and sample-rate indices', () => {
    expect(parseFrameHeader(frameHeader({ bitrateIndex: 0 }), 0)).toBeNull()
    expect(parseFrameHeader(frameHeader({ bitrateIndex: 15 }), 0)).toBeNull()
    expect(parseFrameHeader(frameHeader({ sampleRateIndex: 3 }), 0)).toBeNull()
  })
})

describe('id3v2Size', () => {
  it('returns the full tag size including the header', () => {
    expect(id3v2Size(id3v2(100))).toBe(110)
  })

  it('returns 0 when there is no tag', () => {
    expect(id3v2Size(frame(417))).toBe(0)
    expect(id3v2Size(Buffer.alloc(4))).toBe(0)
  })

  it('decodes syncsafe sizes above 127', () => {
    // 200 spans two syncsafe bytes; a naive big-endian read would get this wrong.
    expect(id3v2Size(id3v2(200))).toBe(210)
  })
})

describe('extractAudioFrames', () => {
  it('returns frames untouched when there is no container metadata', () => {
    const file = Buffer.concat([frame(417), frame(417)])
    const out = extractAudioFrames(file)

    expect(out.frameCount).toBe(2)
    expect(out.audioBytes).toBe(834)
    expect(out.audio.equals(file)).toBe(true)
  })

  it('strips a leading ID3v2 tag', () => {
    const audio = Buffer.concat([frame(417), frame(417)])
    const out = extractAudioFrames(Buffer.concat([id3v2(500), audio]))

    expect(out.frameCount).toBe(2)
    expect(out.audio.equals(audio)).toBe(true)
  })

  it('strips a trailing ID3v1 tag', () => {
    const audio = Buffer.concat([frame(417), frame(417)])
    const id3v1 = Buffer.alloc(128)
    id3v1.write('TAG', 0, 'latin1')
    const out = extractAudioFrames(Buffer.concat([audio, id3v1]))

    expect(out.frameCount).toBe(2)
    expect(out.audio.equals(audio)).toBe(true)
  })

  it('drops the Xing header frame, which would decode as silence', () => {
    const xing = Buffer.concat([frameHeader(), Buffer.from('Xing'), Buffer.alloc(409)])
    const real = frame(417)
    const out = extractAudioFrames(Buffer.concat([xing, real]))

    expect(out.frameCount).toBe(1)
    expect(out.audio.equals(real)).toBe(true)
  })

  it('drops an Info header frame too (the CBR spelling of Xing)', () => {
    const info = Buffer.concat([frameHeader(), Buffer.from('Info'), Buffer.alloc(409)])
    const out = extractAudioFrames(Buffer.concat([info, frame(417)]))
    expect(out.frameCount).toBe(1)
  })

  it('only drops a VBR header once, not every matching frame', () => {
    // A real frame whose audio data happens to contain "Xing" must be kept.
    const xing = Buffer.concat([frameHeader(), Buffer.from('Xing'), Buffer.alloc(409)])
    const lookalike = Buffer.concat([frameHeader(), Buffer.from('Xing'), Buffer.alloc(409)])
    const out = extractAudioFrames(Buffer.concat([xing, lookalike, frame(417)]))

    expect(out.frameCount).toBe(2)
  })

  it('derives duration from frame count', () => {
    // 1152 samples per frame at 44100Hz = 26.12ms per frame.
    const out = extractAudioFrames(Buffer.concat(Array(43).fill(frame(417))))
    expect(out.durationSec).toBeCloseTo((43 * 1152) / 44100, 5)
  })

  it('resyncs past garbage between frames', () => {
    const out = extractAudioFrames(
      Buffer.concat([frame(417), Buffer.alloc(37, 0x13), frame(417)])
    )
    expect(out.frameCount).toBe(2)
  })

  it('concatenating two extractions yields exactly the sum of their bytes', () => {
    // This is the property the playlist stream depends on.
    const a = extractAudioFrames(Buffer.concat([id3v2(80), frame(417), frame(417)]))
    const b = extractAudioFrames(Buffer.concat([id3v2(44), frame(417)]))
    const joined = Buffer.concat([a.audio, b.audio])

    expect(joined.length).toBe(a.audioBytes + b.audioBytes)
    expect(extractAudioFrames(joined).frameCount).toBe(3)
  })
})

describe('profileAudio', () => {
  it('agrees with extractAudioFrames without materialising audio', () => {
    const file = Buffer.concat([id3v2(80), frame(417), frame(417), frame(418, { padding: 1 })])
    const full = extractAudioFrames(file)
    const profile = profileAudio(file)

    expect(profile.audioBytes).toBe(full.audioBytes)
    expect(profile.frameCount).toBe(full.frameCount)
    expect(profile.durationSec).toBe(full.durationSec)
    expect(profile.sampleRate).toBe(full.sampleRate)
    expect(profile.channels).toBe(full.channels)
  })

  it('reports zeroes for a file with no frames', () => {
    const profile = profileAudio(Buffer.alloc(512))
    expect(profile.audioBytes).toBe(0)
    expect(profile.frameCount).toBe(0)
    expect(profile.durationSec).toBe(0)
  })
})
