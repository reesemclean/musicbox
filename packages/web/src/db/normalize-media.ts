/**
 * One-off: re-encode library files that predate the canonical format.
 *
 *   npm run media:normalize -- --dry-run
 *   npm run media:normalize
 *
 * Deliberately NOT run at startup. Re-encoding is lossy and rewrites the
 * user's files, so it should be an explicit choice rather than something that
 * happens on a deploy.
 *
 * Why it's needed: the playlist stream concatenates MP3 frames from several
 * tracks into one response, which requires every track in a playlist to share
 * a sample rate and channel count. Ingest now enforces that for new media, so
 * this exists to bring older files into line — otherwise a playlist mixing old
 * and new tracks would produce a stream the decoder can't follow.
 *
 * Each file is transcoded to a temp path and renamed over the original only on
 * success, so an interrupted run leaves the library untouched.
 */
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { media } from './schema.js'
import { profileAudio } from '../lib/mp3.js'
import {
  CANONICAL_CHANNELS,
  CANONICAL_MIME,
  CANONICAL_SAMPLE_RATE,
  isCanonical,
  transcodeToCanonical,
} from '../services/audioNormalize.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const items = await db
    .select({
      id: media.id,
      title: media.title,
      filePath: media.filePath,
      sampleRate: media.sampleRate,
      channels: media.channels,
    })
    .from(media)

  const candidates = items.filter(
    (i) =>
      i.filePath?.toLowerCase().endsWith('.mp3') &&
      !(i.sampleRate === CANONICAL_SAMPLE_RATE && i.channels === CANONICAL_CHANNELS)
  )

  console.log(
    `Canonical format: ${CANONICAL_SAMPLE_RATE}Hz, ` +
      `${CANONICAL_CHANNELS === 1 ? 'mono' : `${CANONICAL_CHANNELS}ch`}, mp3`
  )
  console.log(`${items.length} media item(s), ${candidates.length} need re-encoding.\n`)

  if (candidates.length === 0) return

  if (dryRun) {
    for (const c of candidates) {
      console.log(`  would convert: ${c.title} (${c.sampleRate}Hz ${c.channels}ch)`)
    }
    console.log('\nDry run — nothing written. Re-run without --dry-run to apply.')
    return
  }

  let converted = 0
  let failed = 0

  for (const item of candidates) {
    const absolute = join(DATA_DIR, item.filePath)
    const temp = join(dirname(absolute), `tmp_normalize_${item.id}.mp3`)

    try {
      await fs.access(absolute)
    } catch {
      console.warn(`  skip (missing file): ${item.title}`)
      failed++
      continue
    }

    try {
      await transcodeToCanonical(absolute, temp)

      const profile = profileAudio(await fs.readFile(temp))
      if (!isCanonical(profile)) {
        throw new Error('output is still not canonical')
      }

      // Only now replace the original.
      await fs.rename(temp, absolute)

      const stat = await fs.stat(absolute)
      await db
        .update(media)
        .set({
          mimeType: CANONICAL_MIME,
          fileSize: stat.size,
          audioBytes: profile.audioBytes,
          sampleRate: profile.sampleRate,
          channels: profile.channels,
          duration: Math.round(profile.durationSec),
        })
        .where(eq(media.id, item.id))

      console.log(`  converted: ${item.title}`)
      converted++
    } catch (err) {
      await fs.unlink(temp).catch(() => {})
      console.error(
        `  FAILED: ${item.title} — ${err instanceof Error ? err.message : err}`
      )
      failed++
    }
  }

  console.log(`\nConverted ${converted}, failed ${failed}.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
