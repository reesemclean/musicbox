import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'

export const media = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['song', 'podcast', 'soundmachine'] }).notNull(),
  title: text('title').notNull(),
  duration: integer('duration'), // in seconds
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  filePath: text('file_path').notNull(),
  metadata: text('metadata', { mode: 'json' }), // type-specific: artist, album, showName, etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const playlists = sqliteTable('playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const playlistMedia = sqliteTable('playlist_media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id').notNull().references(() => playlists.id, { onDelete: 'cascade' }),
  mediaId: integer('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
})

export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mac: text('mac').notNull().unique(),
  name: text('name'),
  secret: text('secret').notNull().unique(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  firmwareVersion: text('firmware_version'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
  lastIp: text('last_ip'),
  soundMachineSound: text('sound_machine_sound'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
