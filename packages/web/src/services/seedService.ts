import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

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
 * Seeds sound machine files and database entries.
 * Copies files from seed-data/soundmachine to data/soundmachine if they don't exist,
 * and creates database entries for them.
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

    // Copy file if it doesn't exist
    if (!existsSync(destPath)) {
      copyFileSync(srcPath, destPath)
      console.log(`[Seed] Copied ${file} to data/soundmachine/`)
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
      const stats = statSync(destPath)
      await db.insert(media).values({
        title: name,
        type: 'soundmachine',
        mimeType: mimeTypeFor(file),
        filePath: relativePath,
        fileSize: stats.size,
        metadata: { system: true },
      })
      console.log(`[Seed] Created DB entry for "${name}"`)
    }
  }

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
