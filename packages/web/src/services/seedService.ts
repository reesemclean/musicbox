import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { db } from '../db/index.js'
import { media, devices } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { ownedPaths } from '../lib/media.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')
const SOUNDMACHINE_SEED_DIR = join(process.cwd(), 'seed-data', 'soundmachine')
const SOUNDMACHINE_DATA_DIR = join(DATA_DIR, 'soundmachine')

const SYSTEM_SOUNDS_SEED_DIR = join(process.cwd(), 'seed-data', 'system-sounds')
const SYSTEM_SOUNDS_DATA_DIR = join(DATA_DIR, 'sounds')

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

function mimeTypeFor(fileName: string): string {
  return MIME_BY_EXT[extname(fileName).toLowerCase()] || 'audio/mpeg'
}

/**
 * Retire sound machine sounds that the image no longer ships.
 *
 * These entries are image-managed (`system: true`), so seed-data is their
 * source of truth — adding a file must make a sound appear and removing one
 * must make it disappear. Without this, seeding only ever grows: a retired
 * sound lingers in the picker forever with no UI anywhere to remove it.
 *
 * Only ever touches system entries, and only when the caller found at least
 * one seed file — so a build that somehow shipped an empty seed directory
 * cannot wipe the list.
 */
async function pruneRemovedSoundMachineSounds(seedFiles: string[]): Promise<void> {
  if (seedFiles.length === 0) return

  const expected = new Set(seedFiles.map((f) => `soundmachine/${f}`))

  const existing = await db
    .select()
    .from(media)
    .where(eq(media.type, 'soundmachine'))

  for (const item of existing) {
    if (!item.metadata?.system) continue // never touch user-added sounds
    if (expected.has(item.filePath)) continue

    // Devices pointing at this sound would otherwise be left with a dangling
    // id — the picker shows nothing selected and pushing config resolves to
    // null. Clear it explicitly so the state is honest.
    await db
      .update(devices)
      .set({ soundMachineSound: null })
      .where(eq(devices.soundMachineSound, String(item.id)))

    for (const relative of ownedPaths(item)) {
      try {
        unlinkSync(join(DATA_DIR, relative))
      } catch {
        // Already gone; the row still needs to go.
      }
    }

    await db.delete(media).where(eq(media.id, item.id))
    console.log(`[Seed] Retired sound machine sound "${item.title}" (no longer shipped)`)
  }
}

/**
 * Seeds sound machine files and database entries.
 *
 * Reconciles rather than only adding: new seed files appear, changed ones
 * replace what's on disk, and removed ones are retired.
 */
export async function seedSoundMachineSounds(): Promise<void> {
  console.log('[Seed] Checking for sound machine sounds to seed...')

  // Ensure directories exist
  if (!existsSync(SOUNDMACHINE_SEED_DIR)) {
    console.log('[Seed] No seed-data/soundmachine directory found, skipping')
    return
  }

  if (!existsSync(SOUNDMACHINE_DATA_DIR)) {
    mkdirSync(SOUNDMACHINE_DATA_DIR, { recursive: true })
    console.log('[Seed] Created data/soundmachine directory')
  }

  // Get list of sound files in seed directory
  const files = readdirSync(SOUNDMACHINE_SEED_DIR).filter(f => {
    const ext = extname(f).toLowerCase()
    return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)
  })

  if (files.length === 0) {
    console.log('[Seed] No sound files found in seed-data/soundmachine')
    return
  }

  console.log(`[Seed] Found ${files.length} sound file(s) to seed`)

  for (const file of files) {
    const srcPath = join(SOUNDMACHINE_SEED_DIR, file)
    const destPath = join(SOUNDMACHINE_DATA_DIR, file)
    const name = basename(file, extname(file))
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()) // Title case

    // The image is the source of truth for these, so a seed file that has
    // changed replaces what's on disk. Comparing size is enough: these are
    // replaced wholesale, never edited in place.
    const seedSize = statSync(srcPath).size
    const replaced = existsSync(destPath) && statSync(destPath).size !== seedSize

    if (!existsSync(destPath) || replaced) {
      copyFileSync(srcPath, destPath)
      console.log(`[Seed] ${replaced ? 'Updated' : 'Copied'} ${file}`)
    }

    // Check if DB entry exists (by file path)
    const relativePath = `soundmachine/${file}`
    const existing = await db
      .select()
      .from(media)
      .where(and(
        eq(media.type, 'soundmachine'),
        eq(media.filePath, relativePath)
      ))
      .limit(1)

    if (existing.length === 0) {
      // Create DB entry
      await db.insert(media).values({
        title: name,
        type: 'soundmachine',
        mimeType: mimeTypeFor(file),
        filePath: relativePath,
        fileSize: seedSize,
        metadata: { system: true },
      })
      console.log(`[Seed] Created DB entry for "${name}"`)
    } else if (replaced) {
      // Clear the derived audio profile so the backfill re-measures the new
      // file rather than trusting figures taken from the old one.
      await db
        .update(media)
        .set({
          fileSize: seedSize,
          audioBytes: null,
          sampleRate: null,
          channels: null,
          duration: null,
        })
        .where(eq(media.id, existing[0].id))
      console.log(`[Seed] Reset audio profile for "${name}"`)
    }
  }

  await pruneRemovedSoundMachineSounds(files)

  console.log('[Seed] Sound machine seeding complete')
}

/**
 * Seeds system sound files (startup, scan, error).
 * Copies files from seed-data/system-sounds to data/sounds if they don't exist.
 * These are not added to the database - they're static files served directly.
 */
export async function seedSystemSounds(): Promise<void> {
  console.log('[Seed] Checking for system sounds to seed...')

  if (!existsSync(SYSTEM_SOUNDS_SEED_DIR)) {
    console.log('[Seed] No seed-data/system-sounds directory found, skipping')
    return
  }

  if (!existsSync(SYSTEM_SOUNDS_DATA_DIR)) {
    mkdirSync(SYSTEM_SOUNDS_DATA_DIR, { recursive: true })
    console.log('[Seed] Created data/sounds directory')
  }

  const files = readdirSync(SYSTEM_SOUNDS_SEED_DIR).filter(f =>
    extname(f).toLowerCase() === '.mp3'
  )

  if (files.length === 0) {
    console.log('[Seed] No sound files found in seed-data/system-sounds')
    return
  }

  console.log(`[Seed] Found ${files.length} system sound(s) to seed`)

  for (const file of files) {
    const srcPath = join(SYSTEM_SOUNDS_SEED_DIR, file)
    const destPath = join(SYSTEM_SOUNDS_DATA_DIR, file)

    if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath)
      console.log(`[Seed] Copied ${file} to data/sounds/`)
    }
  }

  console.log('[Seed] System sounds seeding complete')
}
