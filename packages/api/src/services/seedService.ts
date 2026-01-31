import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const SEED_DATA_DIR = join(process.cwd(), 'seed-data', 'soundmachine')
const DATA_DIR = join(process.cwd(), 'data', 'soundmachine')

/**
 * Seeds sound machine files and database entries.
 * Copies files from seed-data/soundmachine to data/soundmachine if they don't exist,
 * and creates database entries for them.
 */
export async function seedSoundMachineSounds(): Promise<void> {
  console.log('[Seed] Checking for sound machine sounds to seed...')

  // Ensure directories exist
  if (!existsSync(SEED_DATA_DIR)) {
    console.log('[Seed] No seed-data/soundmachine directory found, skipping')
    return
  }

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
    console.log('[Seed] Created data/soundmachine directory')
  }

  // Get list of sound files in seed directory
  const files = readdirSync(SEED_DATA_DIR).filter(f => {
    const ext = extname(f).toLowerCase()
    return ['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)
  })

  if (files.length === 0) {
    console.log('[Seed] No sound files found in seed-data/soundmachine')
    return
  }

  console.log(`[Seed] Found ${files.length} sound file(s) to seed`)

  for (const file of files) {
    const srcPath = join(SEED_DATA_DIR, file)
    const destPath = join(DATA_DIR, file)
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
        filePath: relativePath,
        fileSize: stats.size,
        metadata: { system: true },
      })
      console.log(`[Seed] Created DB entry for "${name}"`)
    }
  }

  console.log('[Seed] Sound machine seeding complete')
}
