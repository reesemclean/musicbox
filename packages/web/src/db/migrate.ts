import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Database path from environment or default
const dbPath = process.env.DATABASE_URL || 'musicbox.db'

console.log(`[Migrate] Running migrations on ${dbPath}...`)

const sqlite = new Database(dbPath)
const db = drizzle(sqlite)

// Run migrations from the drizzle folder
const migrationsFolder = join(__dirname, '../../drizzle')

try {
  migrate(db, { migrationsFolder })
  console.log('[Migrate] Migrations completed successfully')
} catch (error) {
  console.error('[Migrate] Migration failed:', error)
  process.exit(1)
} finally {
  sqlite.close()
}
