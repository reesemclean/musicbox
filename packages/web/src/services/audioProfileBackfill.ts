import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isNull, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { profileAudio } from '../lib/mp3.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

/**
 * Measure decodable audio for rows that predate the audioBytes column.
 *
 * The playlist stream sums audioBytes to produce an exact Content-Length; a
 * track with a null value can't be included without reading it first, which is
 * exactly what the column exists to avoid.
 *
 * Runs once at startup. Parsing is cheap (~4ms for a 6.4MB file), and only
 * unmeasured rows are touched, so this is a no-op on every boot after the
 * first. Failures are logged and skipped rather than retried forever — a file
 * that won't parse won't parse next boot either.
 */
export async function backfillAudioProfiles(): Promise<void> {
  // Select on the file extension rather than mimeType: not every ingest path
  // has historically set mimeType, and a row missing it is exactly the kind of
  // row most likely to be missing audioBytes too.
  const candidates = await db
    .select({ id: media.id, filePath: media.filePath, duration: media.duration })
    .from(media)
    .where(isNull(media.audioBytes))

  const pending = candidates.filter((c) => c.filePath?.toLowerCase().endsWith('.mp3'))

  if (pending.length === 0) return

  console.log(`[Backfill] Measuring audio for ${pending.length} media item(s)...`)

  let measured = 0
  let skipped = 0

  for (const item of pending) {
    if (!item.filePath) {
      skipped++
      continue
    }

    try {
      const buf = await fs.readFile(join(DATA_DIR, item.filePath))
      const profile = profileAudio(buf)

      if (profile.audioBytes === 0) {
        console.warn(`[Backfill] No audio frames found in ${item.filePath}, skipping`)
        skipped++
        continue
      }

      // Fill duration too if it was never captured — we already have an exact
      // frame-derived value here, so there is no reason to leave it null.
      const update: { audioBytes: number; duration?: number } = {
        audioBytes: profile.audioBytes,
      }
      if (item.duration == null && profile.durationSec > 0) {
        update.duration = Math.round(profile.durationSec)
      }

      await db.update(media).set(update).where(eq(media.id, item.id))

      measured++
    } catch (err) {
      console.warn(
        `[Backfill] Could not measure ${item.filePath}: ${err instanceof Error ? err.message : err}`
      )
      skipped++
    }
  }

  console.log(`[Backfill] Measured ${measured}, skipped ${skipped}`)
}
