import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import type { AudioProfile } from '../lib/mp3.js'

/**
 * The one encoding every library item is stored in.
 *
 * Sample rate and channel count must be identical across a playlist for the
 * continuous stream to concatenate frames without transcoding (see
 * docs/decisions/2026-08-02-playlist-streaming.md). Bitrate may vary freely —
 * VBR files already vary it frame to frame.
 *
 * Mono is not a compromise here: the device mixes to mono for its single
 * speaker anyway (`forceMono(true)`), so storing stereo would double the
 * bytes streamed over WiFi for audio that is discarded on arrival.
 */
export const CANONICAL_SAMPLE_RATE = 44100
export const CANONICAL_CHANNELS = 1
export const CANONICAL_MIME = 'audio/mpeg'
/** Target for re-encodes. Generous for mono at this sample rate. */
const CANONICAL_BITRATE = '128k'

/** Does this file already meet the canonical encoding, needing no re-encode? */
export function isCanonical(profile: AudioProfile): boolean {
  return (
    profile.frameCount > 0 &&
    profile.sampleRate === CANONICAL_SAMPLE_RATE &&
    profile.channels === CANONICAL_CHANNELS
  )
}

/**
 * Transcode any ffmpeg-readable audio to the canonical encoding.
 *
 * Only call when {@link isCanonical} is false — re-encoding is lossy, so a
 * conforming file should be kept byte-for-byte rather than round-tripped.
 */
export async function transcodeToCanonical(
  srcPath: string,
  destPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-y',
      '-i', srcPath,
      '-vn', // drop cover art; it would land in the output as a video stream
      '-map_metadata', '-1', // no ID3 passthrough — we store metadata in the DB
      '-ar', String(CANONICAL_SAMPLE_RATE),
      '-ac', String(CANONICAL_CHANNELS),
      '-b:a', CANONICAL_BITRATE,
      '-f', 'mp3',
      destPath,
    ])

    let stderr = ''
    ff.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    ff.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`))
    })

    ff.on('error', (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`))
    })
  })

  // A zero-byte output means ffmpeg reported success but produced nothing
  // usable; treat that as a failure rather than storing an empty file.
  const stat = await fs.stat(destPath)
  if (stat.size === 0) {
    throw new Error('ffmpeg produced an empty file')
  }
}
