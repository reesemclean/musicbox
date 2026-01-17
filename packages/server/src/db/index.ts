import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema.ts'

// In production (Docker), DATABASE_URL is an absolute path like /app/data/musicbox.db
// In development, it's a relative path like ./data/dev.db
const dbPath = process.env.DATABASE_URL || './data/dev.db'

const sqlite = new Database(dbPath)
export const db = drizzle(sqlite, { schema })

// Run migrations on startup
// In production: /app/drizzle, in dev: ./drizzle (relative to cwd which is packages/server)
const migrationsFolder =
  process.env.NODE_ENV === 'production'
    ? '/app/drizzle'
    : path.join(process.cwd(), 'drizzle')

console.log(`[DB] Running migrations from: ${migrationsFolder}`)
migrate(db, { migrationsFolder })
console.log('[DB] Migrations applied successfully')

// Start podcast scheduler after DB is ready
import('@/lib/podcastScheduler').catch((err) => {
  console.error('[DB] Failed to start podcast scheduler:', err)
})
