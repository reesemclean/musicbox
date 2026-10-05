import { describe, expect, it } from 'vitest'
import {
  CONFIRM_TIMEOUT_MS,
  followReportedTrack,
  resolveSkip,
  resolveSkipFrom,
  RESTART_THRESHOLD_SEC,
  type PlaylistPosition,
} from './skip'

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

// Five tracks, with mediaIds that don't match their indexes so the two can't
// be confused.
const tracks = [10, 20, 30, 40, 50]
const issuedAt = 1_000_000
const soon = issuedAt + 500

/** A play just issued for the track at `index`, not yet reported back. */
function issued(index: number, trackIds = tracks): PlaylistPosition {
  return { index, mediaId: trackIds[index], confirmed: false, issuedAt }
}

function confirmed(index: number, trackIds = tracks): PlaylistPosition {
  return { ...issued(index, trackIds), confirmed: true }
}

describe('followReportedTrack', () => {
  it('is confirmed when the device reports the track it was sent', () => {
    expect(followReportedTrack(issued(2), tracks, 30, soon)).toEqual(confirmed(2))
  })

  it('ignores the stream being left until the new one is confirmed', () => {
    // Sent to index 3 while index 1 was playing; the device then announces the
    // track after 1, from the old stream, before it has acted on the play.
    const position = issued(3)
    expect(followReportedTrack(position, tracks, 30, soon)).toBe(position)
  })

  it('follows the stream from track to track once confirmed', () => {
    expect(followReportedTrack(confirmed(1), tracks, 30, soon)).toEqual(confirmed(2))
  })

  it('never follows a report backwards', () => {
    const position = confirmed(3)
    expect(followReportedTrack(position, tracks, 20, soon)).toBe(position)
  })

  it('stops waiting for the confirmation after a while', () => {
    const later = issuedAt + CONFIRM_TIMEOUT_MS
    expect(followReportedTrack(issued(1), tracks, 30, later)).toEqual(confirmed(2))
  })

  it('picks the copy ahead when a playlist holds a track twice', () => {
    const repeated = [10, 20, 10, 30]
    expect(followReportedTrack(confirmed(1, repeated), repeated, 10, soon)).toEqual(
      confirmed(2, repeated)
    )
  })

  it('follows on from wherever an edit moved the current track', () => {
    // 30 was at index 2 when recorded; a track ahead of it has since gone.
    const edited = [10, 30, 40, 50]
    expect(followReportedTrack(confirmed(2), edited, 40, soon)).toEqual(confirmed(2, edited))
  })
})

describe('resolveSkipFrom', () => {
  it('advances once per press, even before the device has caught up', () => {
    const first = resolveSkipFrom(confirmed(1), tracks, 'next', 0, soon)
    expect(first).toEqual({ action: 'play', index: 2 })

    // The second press arrives before the device reports the first. It moves
    // on from the track just sent, not from the one the device last reported.
    const second = resolveSkipFrom(issued(2), tracks, 'next', 0, soon)
    expect(second).toEqual({ action: 'play', index: 3 })
  })

  it("disregards elapsed time until the device has started the track it was sent", () => {
    // 45s is how far into the *old* track the device was. The new one has
    // barely begun, so previous means go back, not restart.
    expect(resolveSkipFrom(issued(3), tracks, 'previous', 45, soon)).toEqual({
      action: 'play',
      index: 2,
    })
  })

  it('honours elapsed time once confirmed', () => {
    expect(resolveSkipFrom(confirmed(3), tracks, 'previous', 45, soon)).toEqual({
      action: 'play',
      index: 3,
    })
  })

  it('resolves from wherever an edit moved the current track', () => {
    const edited = [10, 30, 40, 50] // 30 moved from index 2 to 1
    expect(resolveSkipFrom(confirmed(2), edited, 'next', 0, soon)).toEqual({
      action: 'play',
      index: 2,
    })
  })

  it('plays from the start when the current track has been removed', () => {
    const edited = [10, 20, 40, 50] // 30 is gone
    expect(resolveSkipFrom(confirmed(2), edited, 'next', 0, soon)).toEqual({
      action: 'play',
      index: 0,
    })
  })
})
