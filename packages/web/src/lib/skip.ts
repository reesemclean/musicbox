/**
 * Where a skip should land.
 *
 * With no device-side queue, skip isn't something the device resolves — it
 * reports that a button was pressed and the server decides what to play next.
 * This is that decision, kept free of I/O so the rules are testable on their
 * own.
 */

export type SkipDirection = 'next' | 'previous'

export type SkipOutcome =
  /** Play the track at this index, from its start. */
  | { action: 'play'; index: number }
  /** Ran off the end of the playlist. */
  | { action: 'stop' }
  /** Nothing sensible to do; leave playback alone. */
  | { action: 'none' }

/**
 * How far into a track "previous" still means "go back one" rather than
 * "restart this one". Past this point, pressing previous is nearly always an
 * attempt to replay the current track.
 */
export const RESTART_THRESHOLD_SEC = 3

export interface SkipRequest {
  direction: SkipDirection
  /** Index of the playing track within the playlist's ordered tracks. */
  currentIndex: number
  trackCount: number
  /** Seconds elapsed within the current track, as reported by the device. */
  elapsedSec: number
  restartThresholdSec?: number
}

export function resolveSkip({
  direction,
  currentIndex,
  trackCount,
  elapsedSec,
  restartThresholdSec = RESTART_THRESHOLD_SEC,
}: SkipRequest): SkipOutcome {
  if (trackCount <= 0) return { action: 'none' }

  // A current index outside the playlist means the two have drifted apart —
  // a track was removed, or a stale status arrived. Treat the request as a
  // fresh start rather than guessing.
  if (currentIndex < 0 || currentIndex >= trackCount) {
    return { action: 'play', index: 0 }
  }

  if (direction === 'next') {
    const next = currentIndex + 1
    return next < trackCount ? { action: 'play', index: next } : { action: 'stop' }
  }

  // previous
  if (elapsedSec > restartThresholdSec) {
    return { action: 'play', index: currentIndex }
  }

  // Pressing previous at the very start of the first track restarts it —
  // there is nowhere further back to go.
  return { action: 'play', index: Math.max(0, currentIndex - 1) }
}

/**
 * Where in a playlist the server believes a device is.
 *
 * Recorded when the server issues a play, then moved along by what the device
 * reports. The reports alone can't be skipped from: the device only announces a
 * new track once it has opened the new stream, so a second press arriving
 * before then would resolve against the same track as the first, and land on
 * the same target.
 */
export interface PlaylistPosition {
  /** Index into the playlist's ordered tracks. */
  index: number
  /** The track at that index when recorded, to notice the playlist changing. */
  mediaId: number
  /**
   * The tracks of plays sent that the device hasn't reported starting yet,
   * oldest first; the last is the one at `index`. Empty once it has caught up.
   *
   * The device acts on plays in the order they were sent and reports each one
   * as it opens that stream, so its reports are counted off against this
   * list. Until the last has been reported, a report describes a stream the
   * device has since been told to leave. Matching on the latest track alone
   * isn't enough: in a burst that comes back to a track — Next, Next,
   * Previous — the first play's report would be taken for the last one's.
   */
  awaiting: number[]
  /** When the latest play was sent, in ms since the epoch. */
  issuedAt: number
}

/**
 * How long to wait for the device to report every play it was sent before
 * going on without those reports.
 *
 * It reports each stream twice — on opening it, and when its first
 * announcement arrives — so this matters only when both are lost, or when a
 * play never reports at all: one that fails to open reports "stopped" rather
 * than "playing", and one dropped on the device reports nothing. Without a
 * limit, either would leave the position stuck for the rest of the playlist.
 */
export const CONFIRM_TIMEOUT_MS = 10_000

function caughtUp(position: PlaylistPosition, now: number): boolean {
  return position.awaiting.length === 0 || now - position.issuedAt >= CONFIRM_TIMEOUT_MS
}

/**
 * Record a play just sent, starting at `index` (where `mediaId` is).
 *
 * `previous` is the position the play was decided from — passed for a skip,
 * whose play queues behind any the device hasn't reported yet. A card scan
 * passes null and starts afresh.
 */
export function issuePlay(
  previous: PlaylistPosition | null,
  index: number,
  mediaId: number,
  now: number
): PlaylistPosition {
  const unreported = previous && !caughtUp(previous, now) ? previous.awaiting : []
  return { index, mediaId, awaiting: [...unreported, mediaId], issuedAt: now }
}

/**
 * Find the recorded track in the playlist as it is now. -1 if it has been
 * removed, which resolveSkip treats as drift.
 */
function currentIndexOf(position: PlaylistPosition, trackIds: number[]): number {
  if (trackIds[position.index] === position.mediaId) return position.index
  // Edited since it was recorded. Find where the track went.
  return trackIds.indexOf(position.mediaId)
}

/**
 * Move the recorded position to match a track the device reported playing.
 *
 * Returns the position unchanged when the report doesn't move it.
 */
export function followReportedTrack(
  position: PlaylistPosition,
  trackIds: number[],
  reportedMediaId: number,
  now: number
): PlaylistPosition {
  if (!caughtUp(position, now)) {
    // Count the report off against the plays not yet reported, strictly in
    // order. Anything else describes a stream the device has since been told
    // to leave — an announcement already in flight when a play went out, or a
    // stream's second report of a track already counted.
    if (reportedMediaId !== position.awaiting[0]) return position
    return { ...position, awaiting: position.awaiting.slice(1) }
  }

  // Caught up, or done waiting.
  const settled = position.awaiting.length === 0 ? position : { ...position, awaiting: [] }
  if (reportedMediaId === settled.mediaId) return settled

  // A stream only ever moves forward, so normally look past the current
  // position — which also picks the right copy when a playlist holds the same
  // track twice. But once the playlist has been edited, the open stream
  // (planned before the edit) no longer lines up with it, and looking ahead
  // can miss a track that was moved earlier. Take the reported track wherever
  // it now is.
  const edited = trackIds[settled.index] !== settled.mediaId
  const next = edited
    ? trackIds.indexOf(reportedMediaId)
    : trackIds.indexOf(reportedMediaId, settled.index + 1)
  if (next < 0) return settled

  return { ...settled, index: next, mediaId: reportedMediaId }
}

/** Decide a skip from a recorded position. */
export function resolveSkipFrom(
  position: PlaylistPosition,
  trackIds: number[],
  direction: SkipDirection,
  elapsedSec: number,
  now: number
): SkipOutcome {
  return resolveSkip({
    direction,
    currentIndex: currentIndexOf(position, trackIds),
    trackCount: trackIds.length,
    // The device's elapsed time belongs to whatever it is playing. Until it
    // has started the last play it was sent, that is a stream it is leaving;
    // the new one has barely begun.
    elapsedSec: caughtUp(position, now) ? elapsedSec : 0,
  })
}
