// Server startup tasks - runs once when this module is first imported
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { seedSystemSounds, seedSoundMachineSounds } from './seedService.js'
import { backfillAudioProfiles } from './audioProfileBackfill.js'
import { mqttService } from './mqttService.js'

let initialized = false

function runMigrations() {
  const dbPath = process.env.DATABASE_URL || 'musicbox.db'
  console.log(`[Migrate] Running migrations on ${dbPath}...`)
  const sqlite = new Database(dbPath)
  const db = drizzle(sqlite)

  // In production (Nitro), drizzle folder is at /app/drizzle
  // In dev, it's at ../../drizzle relative to this file
  const migrationsFolder = process.env.NODE_ENV === 'production'
    ? join(process.cwd(), 'drizzle')
    : join(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

  try {
    migrate(db, { migrationsFolder })
    console.log('[Migrate] Migrations completed successfully')
  } finally {
    sqlite.close()
  }
}

export async function ensureInitialized(): Promise<void> {
  if (initialized) return
  initialized = true

  console.log('[Startup] Running initialization tasks...')
  runMigrations()
  await seedSystemSounds()
  await seedSoundMachineSounds()

  // After seeding, so freshly-seeded sound machine files get measured too.
  await backfillAudioProfiles()

  // Connect to MQTT broker for device communication
  try {
    await mqttService.connect()
  } catch (err) {
    console.error('[Startup] MQTT connection failed (will retry on reconnect):', err)
  }

  console.log('[Startup] Initialization complete')
}

// Run on module load (server-side only)
if (typeof window === 'undefined') {
  ensureInitialized().catch(err => {
    console.error('[Startup] Initialization failed:', err)
  })
}
