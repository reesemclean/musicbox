import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// NFC card to content mappings
export const cards = sqliteTable('cards', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  nfcId: text('nfc_id').notNull().unique(),
  contentType: text('content_type', {
    enum: ['song', 'playlist', 'action'],
  }).notNull(),
  contentPath: text('content_path'),
  action: text('action', {
    enum: ['play', 'pause', 'next', 'previous', 'stop'],
  }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

export type Card = typeof cards.$inferSelect
export type NewCard = typeof cards.$inferInsert

// Registered Pi devices
export const devices = sqliteTable('devices', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  ipAddress: text('ip_address'),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
  libraryVersion: integer('library_version').default(0),
})

// Download queue (YouTube Music)
export const downloadQueue = sqliteTable('download_queue', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  targetPath: text('target_path'),
  status: text('status', {
    enum: ['pending', 'downloading', 'failed'],
  }).notNull(),
  progress: integer('progress').default(0),
  error: text('error'),
  addedAt: integer('added_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

// Play statistics
export const playHistory = sqliteTable('play_history', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  deviceId: integer('device_id')
    .notNull()
    .references(() => devices.id),
  songPath: text('song_path').notNull(),
  playedAt: integer('played_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

// Library version tracking (for sync coordination)
export const libraryVersion = sqliteTable('library_version', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  version: integer('version').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
  changeDescription: text('change_description'),
})

// Songs in the library
export const songs = sqliteTable('songs', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  duration: integer('duration'), // in seconds
  fileData: blob('file_data', { mode: 'buffer' }).notNull(), // Audio file as BLOB
  mimeType: text('mime_type').notNull(), // e.g., 'audio/mpeg', 'audio/mp4'
  fileSize: integer('file_size').notNull(), // in bytes
  youtubeVideoId: text('youtube_video_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

export type Song = typeof songs.$inferSelect

// Playlists
export const playlists = sqliteTable('playlists', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

export type Playlist = typeof playlists.$inferSelect

// Playlist songs (join table with ordering)
export const playlistSongs = sqliteTable('playlist_songs', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  playlistId: integer('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  songId: integer('song_id')
    .notNull()
    .references(() => songs.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(), // 0-indexed position in playlist
  addedAt: integer('added_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})
