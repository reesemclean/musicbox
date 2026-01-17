import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from './schema.ts'

// Resolve database path relative to server package root
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(__dirname, '../..')
const dbPath = path.resolve(
  serverRoot,
  process.env.DATABASE_URL || './data/dev.db',
)

const sqlite = new Database(dbPath)
export const db = drizzle(sqlite, { schema })

// Run migrations on startup
const migrationsFolder = path.join(serverRoot, 'drizzle')
migrate(db, { migrationsFolder })
