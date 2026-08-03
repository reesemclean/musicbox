import { describe, expect, it } from 'vitest'
import { resolveSkip, RESTART_THRESHOLD_SEC } from './skip'

const base = { trackCount: 5, elapsedSec: 0 }

describe('resolveSkip — next', () => {
  it('advances one track', () => {
    expect(resolveSkip({ ...base, direction: 'next', currentIndex: 1 })).toEqual({
      action: 'play',
      index: 2,
    })
  })

  it('stops at the end rather than wrapping', () => {
    expect(resolveSkip({ ...base, direction: 'next', currentIndex: 4 })).toEqual({
      action: 'stop',
    })
  })

  it('ignores elapsed time — next always means next', () => {
    expect(
      resolveSkip({ ...base, direction: 'next', currentIndex: 1, elapsedSec: 120 })
    ).toEqual({ action: 'play', index: 2 })
  })
})

describe('resolveSkip — previous', () => {
  it('goes back one when pressed early in the track', () => {
    expect(
      resolveSkip({ ...base, direction: 'previous', currentIndex: 3, elapsedSec: 1 })
    ).toEqual({ action: 'play', index: 2 })
  })

  it('restarts the current track when pressed later in it', () => {
    expect(
      resolveSkip({ ...base, direction: 'previous', currentIndex: 3, elapsedSec: 30 })
    ).toEqual({ action: 'play', index: 3 })
  })

  it('treats the threshold as exclusive', () => {
    // Exactly at the threshold still counts as "early", so it goes back.
    expect(
      resolveSkip({
        ...base,
        direction: 'previous',
        currentIndex: 2,
        elapsedSec: RESTART_THRESHOLD_SEC,
      })
    ).toEqual({ action: 'play', index: 1 })

    expect(
      resolveSkip({
        ...base,
        direction: 'previous',
        currentIndex: 2,
        elapsedSec: RESTART_THRESHOLD_SEC + 0.1,
      })
    ).toEqual({ action: 'play', index: 2 })
  })

  it('restarts the first track rather than running off the front', () => {
    expect(
      resolveSkip({ ...base, direction: 'previous', currentIndex: 0, elapsedSec: 0 })
    ).toEqual({ action: 'play', index: 0 })
  })

  it('honours a custom threshold', () => {
    expect(
      resolveSkip({
        ...base,
        direction: 'previous',
        currentIndex: 2,
        elapsedSec: 5,
        restartThresholdSec: 10,
      })
    ).toEqual({ action: 'play', index: 1 })
  })
})

describe('resolveSkip — degenerate input', () => {
  it('does nothing for an empty playlist', () => {
    expect(
      resolveSkip({ direction: 'next', currentIndex: 0, trackCount: 0, elapsedSec: 0 })
    ).toEqual({ action: 'none' })
  })

  it('restarts from the top when the current track is not in the playlist', () => {
    // The playlist changed under us, or a stale status arrived.
    for (const direction of ['next', 'previous'] as const) {
      expect(resolveSkip({ ...base, direction, currentIndex: 99 })).toEqual({
        action: 'play',
        index: 0,
      })
      expect(resolveSkip({ ...base, direction, currentIndex: -1 })).toEqual({
        action: 'play',
        index: 0,
      })
    }
  })

  it('handles a single-track playlist', () => {
    const single = { trackCount: 1, currentIndex: 0, elapsedSec: 0 }
    expect(resolveSkip({ ...single, direction: 'next' })).toEqual({ action: 'stop' })
    expect(resolveSkip({ ...single, direction: 'previous' })).toEqual({
      action: 'play',
      index: 0,
    })
  })
})
