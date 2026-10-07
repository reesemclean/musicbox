import { describe, expect, it } from 'vitest'
import {
  CONFIRM_TIMEOUT_MS,
  followReportedTrack,
  issuePlay,
  resolveSkip,
  resolveSkipFrom,
  RESTART_THRESHOLD_SEC,
  type PlaylistPosition,
  type SkipDirection,
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
  return { index, mediaId: trackIds[index], awaiting: [trackIds[index]], issuedAt }
}

/** The device has reported every play it was sent, ending on `index`. */
function confirmed(index: number, trackIds = tracks): PlaylistPosition {
  return { ...issued(index, trackIds), awaiting: [] }
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

// End to end, the way mqttService drives these: each press resolves a skip
// from the current position and issues the play; the device's "playing"
// reports then arrive in the order the plays were sent.

/** A press, as handleSkip handles it, for presses expected to send a play. */
function press(
  position: PlaylistPosition,
  direction: SkipDirection,
  { elapsedSec = 0, now = soon, trackIds = tracks } = {}
): PlaylistPosition {
  const outcome = resolveSkipFrom(position, trackIds, direction, elapsedSec, now)
  if (outcome.action !== 'play') throw new Error(`expected a play, got ${outcome.action}`)
  return issuePlay(position, outcome.index, trackIds[outcome.index], now)
}

function reports(position: PlaylistPosition, mediaIds: number[], trackIds = tracks): PlaylistPosition {
  return mediaIds.reduce((p, id) => followReportedTrack(p, trackIds, id, soon), position)
}

describe('a burst of skips', () => {
  it('counts the device off play by play, even when the burst comes back on itself', () => {
    // On 20. Next, Next, Next, Previous, Previous — overshoot and correct —
    // all before the device has opened the first stream. Plays sent: 30, 40,
    // 50, 40, 30.
    let p = confirmed(1)
    for (const d of ['next', 'next', 'next', 'previous', 'previous'] as const) p = press(p, d)
    expect(p).toMatchObject({ index: 2, mediaId: 30, awaiting: [30, 40, 50, 40, 30] })

    // Matching on the latest track alone took the first report, of 30, as
    // confirming the last play, then followed 40 and 50 forward and ignored
    // the rest — leaving the server on 50 while the device played 30.
    p = reports(p, [30, 40, 50, 40, 30])
    expect(p).toMatchObject({ index: 2, mediaId: 30, awaiting: [] })

    // So Next plays 40 rather than running off the end.
    expect(resolveSkipFrom(p, tracks, 'next', 0, soon)).toEqual({ action: 'play', index: 3 })
  })

  it('lands on the right track after Next, Next, Previous', () => {
    let p = confirmed(1)
    for (const d of ['next', 'next', 'previous'] as const) p = press(p, d)
    p = reports(p, [30, 40, 30])
    expect(p).toMatchObject({ index: 2, mediaId: 30, awaiting: [] })
    expect(resolveSkipFrom(p, tracks, 'next', 0, soon)).toEqual({ action: 'play', index: 3 })
  })

  it("ignores a stream's second report of a track already counted", () => {
    // Each stream reports on opening and again with its first announcement.
    let p = confirmed(1)
    for (const d of ['next', 'next', 'previous'] as const) p = press(p, d)
    p = reports(p, [30, 30, 40, 40, 30, 30])
    expect(p).toMatchObject({ index: 2, mediaId: 30, awaiting: [] })
  })

  it('ignores reports from a stream the device has been told to leave', () => {
    // Plays for 30 and 40 are on their way; the old stream, still on 20,
    // reports it again (a resume, say). Nothing moves.
    const p = press(press(confirmed(1), 'next'), 'next')
    expect(followReportedTrack(p, tracks, 20, soon)).toBe(p)
  })

  it('does not jump ahead to a later play whose report arrives first', () => {
    // Strictly in order: a report matching a later entry doesn't skip the
    // ones before it.
    const p = press(press(confirmed(1), 'next'), 'next') // awaiting [30, 40]
    expect(followReportedTrack(p, tracks, 40, soon)).toBe(p)
  })

  it('stops waiting after the timeout and follows the stream again', () => {
    // The plays for 30 and 40 never reported — one failed to open, say.
    const p = press(press(confirmed(1), 'next'), 'next')
    // Not yet: a moment before the deadline, the count still holds.
    expect(followReportedTrack(p, tracks, 50, p.issuedAt + CONFIRM_TIMEOUT_MS - 1)).toBe(p)

    const later = p.issuedAt + CONFIRM_TIMEOUT_MS
    expect(followReportedTrack(p, tracks, 50, later)).toMatchObject({
      index: 4,
      mediaId: 50,
      awaiting: [],
    })
    // And a press then starts a fresh count rather than queueing behind them.
    expect(issuePlay(p, 4, 50, later).awaiting).toEqual([50])
  })

  it('starts afresh on a card scan', () => {
    expect(issuePlay(null, 0, 10, soon)).toEqual({
      index: 0,
      mediaId: 10,
      awaiting: [10],
      issuedAt: soon,
    })
  })
})

describe('a playlist edited mid-listen', () => {
  it('follows the stream when the playing track is moved later', () => {
    // [10, 20, 30, 40] while 20 plays; a parent drags 20 to the end. The open
    // stream still goes 20 -> 30 -> 40. Looking only ahead of 20's new place
    // would never find 30, and Next would then stop playback.
    const edited = [10, 30, 40, 20]
    const p = followReportedTrack(confirmed(1, [10, 20, 30, 40]), edited, 30, soon)
    expect(p).toMatchObject({ index: 1, mediaId: 30, awaiting: [] })
    expect(resolveSkipFrom(p, edited, 'next', 0, soon)).toEqual({ action: 'play', index: 2 })
  })
})
