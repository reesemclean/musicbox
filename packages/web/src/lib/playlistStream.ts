import { ICY_METAINT, ICY_EMPTY_BLOCK, icyMetadataBlock, encodeTrackAnnouncement } from './icy.js'

/**
 * Planning and framing for the continuous playlist stream.
 *
 * The stream is one HTTP response covering every track back to back, so the
 * device never reconnects between tracks and there is no gap to hide. Which
 * track is playing is signalled in-band with ICY metadata rather than out of
 * band, so it costs no extra connection.
 *
 * Everything here works from track *lengths*, never file contents, so the
 * exact Content-Length can be computed without opening a single file.
 */

export interface PlannedTrack {
  mediaId: number
  title: string
  /** Bytes of decodable audio frames, as recorded at ingest. */
  audioBytes: number
  /** Path relative to DATA_DIR of the file whose frames get emitted. */
  path: string
}

/** One piece of the outgoing byte sequence. */
export type StreamPart =
  | { kind: 'audio'; track: PlannedTrack; offset: number; length: number }
  | { kind: 'metadata'; bytes: Buffer }

export interface StreamPlan {
  parts: StreamPart[]
  /** Exact body size, audio plus interleaved metadata. */
  totalBytes: number
  audioBytes: number
}

/**
 * Lay out the exact byte sequence for a playlist.
 *
 * Producing the plan and the Content-Length from a single pass means the two
 * cannot disagree — a mismatch would either truncate the response or leave the
 * client waiting for bytes that never arrive.
 *
 * With `withMetadata` false the result is plain concatenated audio, for clients
 * that didn't ask for ICY metadata (a browser, say).
 */
export function planPlaylistStream(
  tracks: PlannedTrack[],
  withMetadata: boolean,
  metaint: number = ICY_METAINT
): StreamPlan {
  const parts: StreamPart[] = []
  let untilMeta = metaint
  let announced = ''
  let audioBytes = 0

  for (const track of tracks) {
    const pending = encodeTrackAnnouncement(track.mediaId, track.title)
    let offset = 0

    while (offset < track.audioBytes) {
      if (withMetadata && untilMeta === 0) {
        // A metadata block lands here, on a metaint boundary. Re-announcing an
        // unchanged title would waste bytes, so send the one-byte "unchanged"
        // marker instead.
        parts.push({
          kind: 'metadata',
          bytes: pending === announced ? ICY_EMPTY_BLOCK : icyMetadataBlock(pending),
        })
        announced = pending
        untilMeta = metaint
      }

      const chunk = withMetadata
        ? Math.min(track.audioBytes - offset, untilMeta)
        : track.audioBytes - offset

      parts.push({ kind: 'audio', track, offset, length: chunk })
      offset += chunk
      audioBytes += chunk
      if (withMetadata) untilMeta -= chunk
    }
  }

  const totalBytes = parts.reduce(
    (n, p) => n + (p.kind === 'audio' ? p.length : p.bytes.length),
    0
  )

  return { parts, totalBytes, audioBytes }
}

/**
 * Are these tracks frame-compatible, i.e. can their frames simply be
 * concatenated?
 *
 * Sample rate is the constraint that actually breaks decoders mid-stream;
 * channel count is included because the device's decoder is far less forgiving
 * than a desktop one. Bitrate may vary freely — VBR files already vary it
 * frame to frame.
 */
export function findIncompatibleTrack(
  tracks: Array<{ mediaId: number; sampleRate: number | null; channels: number | null }>
): { mediaId: number; reason: string } | null {
  const first = tracks[0]
  if (!first) return null

  for (const track of tracks) {
    if (track.sampleRate == null || track.channels == null) {
      return { mediaId: track.mediaId, reason: 'audio profile not measured' }
    }
    if (track.sampleRate !== first.sampleRate) {
      return {
        mediaId: track.mediaId,
        reason: `sample rate ${track.sampleRate}Hz differs from ${first.sampleRate}Hz`,
      }
    }
    if (track.channels !== first.channels) {
      return {
        mediaId: track.mediaId,
        reason: `channel count ${track.channels} differs from ${first.channels}`,
      }
    }
  }

  return null
}
