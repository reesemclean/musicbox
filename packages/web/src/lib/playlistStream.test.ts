import { describe, expect, it } from 'vitest'
import { findIncompatibleTrack, planPlaylistStream, type PlannedTrack } from './playlistStream'
import { ICY_EMPTY_BLOCK } from './icy'

const track = (mediaId: number, audioBytes: number, title = `Track ${mediaId}`): PlannedTrack => ({
  mediaId,
  title,
  audioBytes,
  path: `songs/${mediaId}.mp3`,
})

/** Total audio bytes the plan will emit, ignoring metadata. */
function audioTotal(plan: ReturnType<typeof planPlaylistStream>) {
  return plan.parts.reduce((n, p) => (p.kind === 'audio' ? n + p.length : n), 0)
}

describe('planPlaylistStream without metadata', () => {
  it('emits exactly the audio, one part per track', () => {
    const plan = planPlaylistStream([track(1, 500), track(2, 300)], false)

    expect(plan.parts).toHaveLength(2)
    expect(plan.totalBytes).toBe(800)
    expect(plan.audioBytes).toBe(800)
    expect(plan.parts.every((p) => p.kind === 'audio')).toBe(true)
  })

  it('produces nothing for an empty playlist', () => {
    const plan = planPlaylistStream([], false)
    expect(plan.parts).toHaveLength(0)
    expect(plan.totalBytes).toBe(0)
  })

  it('skips zero-length tracks without emitting a part', () => {
    const plan = planPlaylistStream([track(1, 0), track(2, 100)], false)
    expect(plan.parts).toHaveLength(1)
    expect(plan.totalBytes).toBe(100)
  })
})

describe('planPlaylistStream with ICY metadata', () => {
  const metaint = 100

  it('inserts the first block after exactly metaint audio bytes', () => {
    const plan = planPlaylistStream([track(1, 250)], true, metaint)

    // audio(100) meta audio(100) meta audio(50)
    expect(plan.parts[0]).toMatchObject({ kind: 'audio', length: 100 })
    expect(plan.parts[1].kind).toBe('metadata')
    expect(plan.parts[2]).toMatchObject({ kind: 'audio', length: 100 })
  })

  it('never lets audio between blocks exceed metaint', () => {
    const plan = planPlaylistStream([track(1, 1000), track(2, 700)], true, metaint)

    let sinceBlock = 0
    for (const part of plan.parts) {
      if (part.kind === 'metadata') {
        sinceBlock = 0
      } else {
        sinceBlock += part.length
        expect(sinceBlock).toBeLessThanOrEqual(metaint)
      }
    }
  })

  it('preserves every audio byte regardless of interleaving', () => {
    const plan = planPlaylistStream([track(1, 1000), track(2, 700)], true, metaint)
    expect(audioTotal(plan)).toBe(1700)
    expect(plan.audioBytes).toBe(1700)
  })

  it('counts metadata bytes in the total, so Content-Length matches the body', () => {
    const plan = planPlaylistStream([track(1, 1000), track(2, 700)], true, metaint)

    const partsTotal = plan.parts.reduce(
      (n, p) => n + (p.kind === 'audio' ? p.length : p.bytes.length),
      0
    )
    expect(plan.totalBytes).toBe(partsTotal)
    expect(plan.totalBytes).toBeGreaterThan(plan.audioBytes)
  })

  it('announces each track once and repeats nothing', () => {
    const plan = planPlaylistStream([track(1, 500), track(2, 500)], true, metaint)

    const announcements = plan.parts.filter(
      (p) => p.kind === 'metadata' && p.bytes.length > 1
    )
    expect(announcements).toHaveLength(2)
  })

  it('uses the one-byte unchanged marker between announcements', () => {
    const plan = planPlaylistStream([track(1, 500)], true, metaint)

    const unchanged = plan.parts.filter(
      (p) => p.kind === 'metadata' && p.bytes.equals(ICY_EMPTY_BLOCK)
    )
    // Blocks at 100..400 are within one track, so only the first announces.
    expect(unchanged.length).toBeGreaterThan(0)
  })

  it('announces a track change within one metaint of the boundary', () => {
    // 150 is not a multiple of metaint, so track 2 starts mid-interval.
    const plan = planPlaylistStream([track(1, 150), track(2, 150)], true, metaint)

    let audioSoFar = 0
    let announcedSecondAt: number | null = null

    for (const part of plan.parts) {
      if (part.kind === 'audio') {
        audioSoFar += part.length
      } else if (part.bytes.length > 1 && part.bytes.includes('2|Track 2')) {
        announcedSecondAt = audioSoFar
      }
    }

    expect(announcedSecondAt).not.toBeNull()
    // Track 2 begins at byte 150; the announcement lands at the next boundary.
    expect(announcedSecondAt!).toBeGreaterThanOrEqual(150)
    expect(announcedSecondAt! - 150).toBeLessThan(metaint)
  })
})

describe('findIncompatibleTrack', () => {
  const ok = (mediaId: number) => ({ mediaId, sampleRate: 44100, channels: 1 })

  it('accepts a uniformly encoded playlist', () => {
    expect(findIncompatibleTrack([ok(1), ok(2), ok(3)])).toBeNull()
  })

  it('accepts an empty playlist', () => {
    expect(findIncompatibleTrack([])).toBeNull()
  })

  it('rejects a differing sample rate, naming the track', () => {
    const bad = findIncompatibleTrack([ok(1), { mediaId: 2, sampleRate: 48000, channels: 1 }])
    expect(bad?.mediaId).toBe(2)
    expect(bad?.reason).toContain('48000')
  })

  it('rejects a differing channel count', () => {
    const bad = findIncompatibleTrack([ok(1), { mediaId: 2, sampleRate: 44100, channels: 2 }])
    expect(bad?.mediaId).toBe(2)
    expect(bad?.reason).toContain('channel')
  })

  it('rejects an unmeasured track', () => {
    const bad = findIncompatibleTrack([ok(1), { mediaId: 2, sampleRate: null, channels: null }])
    expect(bad?.mediaId).toBe(2)
    expect(bad?.reason).toContain('not measured')
  })

  it('compares against the first track, not a global default', () => {
    // An all-48kHz stereo playlist is internally consistent and allowed.
    const tracks = [
      { mediaId: 1, sampleRate: 48000, channels: 2 },
      { mediaId: 2, sampleRate: 48000, channels: 2 },
    ]
    expect(findIncompatibleTrack(tracks)).toBeNull()
  })
})
