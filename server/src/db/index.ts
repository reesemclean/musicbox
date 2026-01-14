import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'

import * as schema from './schema.ts'

const sqlite = new Database(process.env.DATABASE_URL)
export const db = drizzle(sqlite, { schema })

// Run migrations on startup
const migrationsFolder = path.join(process.cwd(), 'drizzle')
migrate(db, { migrationsFolder })
console.log('Database migrations applied successfully')
