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
