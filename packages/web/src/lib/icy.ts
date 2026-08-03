/**
 * ICY (Shoutcast) metadata framing.
 *
 * ICY interleaves metadata into the audio byte stream: after every `metaint`
 * bytes of audio comes a length byte (in 16-byte units), followed by that many
 * bytes of metadata — or a single zero byte meaning "unchanged since the last
 * block".
 *
 * ESP32-audioI2S requests this on every connecttohost() and surfaces
 * StreamTitle via its streamtitle event, which is how the device learns the
 * current track mid-stream without opening a new connection.
 */

/**
 * Audio bytes between metadata blocks.
 *
 * Also the worst-case lag on reporting a track change: ~510ms at 128kbps,
 * ~275ms at 238kbps. Measured lag in practice was 42-84ms.
 */
export const ICY_METAINT = 8192

/** A single zero byte: "metadata unchanged since last block". */
export const ICY_EMPTY_BLOCK = Buffer.from([0])

/**
 * Build a metadata block announcing `title`.
 *
 * Single quotes are stripped because the StreamTitle value is itself
 * single-quoted and the format has no escaping.
 */
export function icyMetadataBlock(title: string): Buffer {
  const payload = Buffer.from(
    `StreamTitle='${title.replace(/'/g, '')}';`,
    'latin1'
  )
  const blocks = Math.ceil(payload.length / 16)
  const out = Buffer.alloc(1 + blocks * 16)
  out[0] = blocks
  payload.copy(out, 1)
  return out
}

/**
 * Encode a track announcement.
 *
 * The mediaId is what the device echoes back in playback_status, so it must
 * survive the round trip; the title is for humans reading logs and for any
 * client that displays stream titles.
 */
export function encodeTrackAnnouncement(mediaId: number, title: string): string {
  return `${mediaId}|${title}`
}
