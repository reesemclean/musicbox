import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

// Database path from environment or default
const dbPath = process.env.DATABASE_URL || 'musicbox.db'
const sqlite = new Database(dbPath)
export const db = drizzle(sqlite, { schema })
