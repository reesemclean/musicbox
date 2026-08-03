import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isNull, or, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { ensureNormalized } from './audioNormalize.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

/**
 * Bring existing library rows up to what newer code expects: a measured audio
 * profile, and a canonical derivative where the original isn't canonical.
 *
 * This is a one-time pass in the same spirit as a database migration — it runs
 * automatically, is idempotent, and skips anything already done. It exists as
 * startup code rather than a CLI script because the production image ships
 * only the built server bundle: there is no `src/` and no `tsx` in the
 * container, so a script would be unrunnable exactly where it's needed.
 *
 * Two properties make it safe to run unattended:
 *
 *  - **Originals are never modified.** A non-canonical file gets a derivative
 *    written alongside it under `normalized/`; the file as ingested is left
 *    byte-for-byte intact.
 *  - **It never blocks startup.** Transcoding runs ~1s per track, so a large
 *    library would take minutes. The container healthcheck fails after ~100s,
 *    so a blocking pass would put a real library into a restart loop, redoing
 *    the work each time. Callers must not await this.
 *
 * Set MUSICBOX_SKIP_MEDIA_BACKFILL=1 to disable.
 */
export async function backfillMedia(): Promise<void> {
  if (process.env.MUSICBOX_SKIP_MEDIA_BACKFILL === '1') {
    console.log('[Backfill] Skipped (MUSICBOX_SKIP_MEDIA_BACKFILL=1)')
    return
  }

  // Any derived field being absent means the row predates one of the columns.
  // Checking only audioBytes would permanently skip rows measured before
  // sampleRate/channels existed.
  const candidates = await db
    .select({
      id: media.id,
      title: media.title,
      filePath: media.filePath,
      normalizedPath: media.normalizedPath,
      sampleRate: media.sampleRate,
      channels: media.channels,
      audioBytes: media.audioBytes,
    })
    .from(media)
    .where(
      or(isNull(media.audioBytes), isNull(media.sampleRate), isNull(media.channels))
    )

  const pending = candidates.filter((c) => c.filePath)

  if (pending.length === 0) return

  console.log(`[Backfill] Processing ${pending.length} media item(s) in background...`)

  let measured = 0
  let normalized = 0
  let skipped = 0

  for (const item of pending) {
    try {
      await fs.access(join(DATA_DIR, item.filePath))
    } catch {
      console.warn(`[Backfill] Missing file for "${item.title}", skipping`)
      skipped++
      continue
    }

    try {
      const result = await ensureNormalized(DATA_DIR, item.filePath)

      if (result.profile.frameCount === 0) {
        console.warn(`[Backfill] No audio frames in "${item.title}", skipping`)
        skipped++
        continue
      }

      await db
        .update(media)
        .set({
          audioBytes: result.profile.audioBytes,
          sampleRate: result.profile.sampleRate,
          channels: result.profile.channels,
          duration: Math.round(result.profile.durationSec),
          normalizedPath: result.normalizedPath,
        })
        .where(eq(media.id, item.id))

      measured++
      if (result.normalizedPath) {
        normalized++
        console.log(`[Backfill] Normalized "${item.title}"`)
      }
    } catch (err) {
      console.warn(
        `[Backfill] Could not process "${item.title}": ${err instanceof Error ? err.message : err}`
      )
      skipped++
    }
  }

  console.log(
    `[Backfill] Done — measured ${measured}, of which ${normalized} needed a canonical copy; skipped ${skipped}`
  )
}
