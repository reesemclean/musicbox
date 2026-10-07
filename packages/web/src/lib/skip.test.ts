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
  return { stream: trackIds, index, mediaId: trackIds[index], awaiting: [trackIds[index]], issuedAt }
}

/** The device has reported every play it was sent, ending on `index`. */
function confirmed(index: number, trackIds = tracks): PlaylistPosition {
  return { ...issued(index, trackIds), awaiting: [] }
}

describe('followReportedTrack', () => {
  it('is confirmed when the device reports the track it was sent', () => {
    expect(followReportedTrack(issued(2), 30, soon)).toEqual(confirmed(2))
  })

  it('ignores the stream being left until the new one is confirmed', () => {
    // Sent to index 3 while index 1 was playing; the device then announces the
    // track after 1, from the old stream, before it has acted on the play.
    const position = issued(3)
    expect(followReportedTrack(position, 30, soon)).toBe(position)
  })

  it('follows the stream from track to track once confirmed', () => {
    expect(followReportedTrack(confirmed(1), 30, soon)).toEqual(confirmed(2))
  })

  it('never follows a report backwards', () => {
    const position = confirmed(3)
    expect(followReportedTrack(position, 20, soon)).toBe(position)
  })

  it('stops waiting for the confirmation after a while', () => {
    const later = issuedAt + CONFIRM_TIMEOUT_MS
    expect(followReportedTrack(issued(1), 30, later)).toEqual(confirmed(2))
  })

  it('picks the copy ahead when a playlist holds a track twice', () => {
    const repeated = [10, 20, 10, 30]
    expect(followReportedTrack(confirmed(1, repeated), 10, soon)).toEqual(
      confirmed(2, repeated)
    )
  })

  it("follows the stream's own order, whatever the playlist says now", () => {
    // It needs no playlist at all: the open stream plays what it was planned
    // from, so its announcements are placed in that.
    expect(followReportedTrack(confirmed(2), 40, soon)).toEqual(confirmed(3))
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
  return issuePlay(position, trackIds, outcome.index, now)
}

function reports(position: PlaylistPosition, mediaIds: number[]): PlaylistPosition {
  return mediaIds.reduce((p, id) => followReportedTrack(p, id, soon), position)
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
    expect(followReportedTrack(p, 20, soon)).toBe(p)
  })

  it('does not jump ahead to a later play whose report arrives first', () => {
    // Strictly in order: a report matching a later entry doesn't skip the
    // ones before it.
    const p = press(press(confirmed(1), 'next'), 'next') // awaiting [30, 40]
    expect(followReportedTrack(p, 40, soon)).toBe(p)
  })

  it('stops waiting after the timeout and follows the stream again', () => {
    // The plays for 30 and 40 never reported — one failed to open, say.
    const p = press(press(confirmed(1), 'next'), 'next')
    // Not yet: a moment before the deadline, the count still holds.
    expect(followReportedTrack(p, 50, p.issuedAt + CONFIRM_TIMEOUT_MS - 1)).toBe(p)

    const later = p.issuedAt + CONFIRM_TIMEOUT_MS
    expect(followReportedTrack(p, 50, later)).toMatchObject({
      index: 4,
      mediaId: 50,
      awaiting: [],
    })
    // And a press then starts a fresh count rather than queueing behind them.
    expect(issuePlay(p, tracks, 4, later).awaiting).toEqual([50])
  })

  it('starts afresh on a card scan', () => {
    expect(issuePlay(null, tracks, 0, soon)).toEqual({
      stream: tracks,
      index: 0,
      mediaId: 10,
      awaiting: [10],
      issuedAt: soon,
    })
  })
})

// The open stream keeps playing the order it was planned from; a skip is then
// resolved against the playlist as edited. Each case: the stream, the track it
// has reached, the edit, and what a press must do.
describe('a playlist edited mid-listen', () => {
  /** Play `planned` from the start and let the stream announce `heard`. */
  function listenTo(planned: number[], heard: number[]): PlaylistPosition {
    return reports(issuePlay(null, planned, 0, soon), [planned[0], ...heard])
  }

  it('the track just played moved to the end: Next plays what follows', () => {
    // [10, 20, 30, 40]; 20 is dragged to the end while it plays, and the
    // stream moves on to 30. Next must play 40, not lose its place.
    const p = listenTo([10, 20, 30, 40], [20, 30])
    expect(resolveSkipFrom(p, [10, 30, 40, 20], 'next', 0, soon)).toEqual({
      action: 'play',
      index: 2, // 40
    })
  })

  it('an upcoming track moved to the end: Next does not stop playback', () => {
    // [10, 20, 30, 40, 50]; 30 is moved to the end, but the stream plays on
    // through 30 and 40. Looking for 40 after 30's new place found nothing,
    // left the position on 30 — now last — and Next stopped.
    const p = listenTo([10, 20, 30, 40, 50], [20, 30, 40])
    expect(p).toMatchObject({ mediaId: 40 })
    expect(resolveSkipFrom(p, [10, 20, 40, 50, 30], 'next', 0, soon)).toEqual({
      action: 'play',
      index: 3, // 50
    })
  })

  it('an upcoming track moved to the top: the track playing is the one restarted', () => {
    // [10, 20, 30, 40, 50]; 40 is moved to the top, and the stream reaches it.
    const p = listenTo([10, 20, 30, 40, 50], [20, 30, 40])
    expect(resolveSkipFrom(p, [40, 10, 20, 30, 50], 'previous', 20, soon)).toEqual({
      action: 'play',
      index: 0, // 40, not 30
    })
  })

  it('a track removed above a duplicate: the copy playing is the one used', () => {
    // [10, 20, 30, 20, 40] has 20 twice. 10 is removed while 30 plays, then
    // the stream reaches the second 20. Taking the first copy sent Next back
    // to 30, the track just heard.
    const p = listenTo([10, 20, 30, 20, 40], [20, 30, 20])
    expect(p).toMatchObject({ index: 3, mediaId: 20 })
    expect(resolveSkipFrom(p, [20, 30, 20, 40], 'next', 0, soon)).toEqual({
      action: 'play',
      index: 3, // 40
    })
  })

  it('a copy of the playing track added at the top: the copy playing is the one used', () => {
    // [10, 20, 30, 40]; a copy of 30 is added at the top while 30 plays.
    const p = listenTo([10, 20, 30, 40], [20, 30])
    expect(resolveSkipFrom(p, [30, 10, 20, 30, 40], 'next', 0, soon)).toEqual({
      action: 'play',
      index: 4, // 40, not 10
    })
  })

  it('the playing track removed: plays from the start', () => {
    const p = listenTo([10, 20, 30, 40], [20, 30])
    expect(resolveSkipFrom(p, [10, 20, 40], 'next', 0, soon)).toEqual({
      action: 'play',
      index: 0,
    })
  })
})
