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
   * Whether the device has reported this track since the play was issued.
   * Until it has, anything it reports is about the stream it is leaving.
   */
  confirmed: boolean
  /** When the play was issued, in ms since the epoch. */
  issuedAt: number
}

/**
 * How long to wait for the device to report the track it was sent before
 * going on without that report.
 *
 * It reports twice — on opening the stream, and when the stream's first
 * announcement arrives — so this only matters if both are lost. Without a
 * limit that would leave the position stuck for the rest of the playlist.
 */
export const CONFIRM_TIMEOUT_MS = 10_000

function isConfirmed(position: PlaylistPosition, now: number): boolean {
  return position.confirmed || now - position.issuedAt >= CONFIRM_TIMEOUT_MS
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
  if (reportedMediaId === position.mediaId) {
    return position.confirmed ? position : { ...position, confirmed: true }
  }

  // Until the device reports the track it was sent, a report of anything else
  // describes the stream it was told to leave — an announcement already in
  // flight when the play went out, say.
  if (!isConfirmed(position, now)) return position

  // A stream only ever moves forward, so look past the current position. That
  // also picks the right copy when a playlist holds the same track twice.
  const next = trackIds.indexOf(reportedMediaId, currentIndexOf(position, trackIds) + 1)
  if (next < 0) return position

  return { ...position, index: next, mediaId: reportedMediaId, confirmed: true }
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
    // has started the track it was last sent, that is the stream it is
    // leaving; the new one has barely begun.
    elapsedSec: isConfirmed(position, now) ? elapsedSec : 0,
  })
}
