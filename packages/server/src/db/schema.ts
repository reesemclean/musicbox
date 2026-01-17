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

// Device registration status
export const deviceStatus = ['pending', 'approved', 'rejected'] as const
export type DeviceStatus = (typeof deviceStatus)[number]

// Deployment status for devices
export const deploymentStatus = [
  'pending',
  'deploying',
  'success',
  'failed',
] as const
export type DeploymentStatus = (typeof deploymentStatus)[number]

// Registered Pi devices
export const devices = sqliteTable('devices', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  secret: text('secret').notNull().unique(), // UUID for authentication
  hardwareId: text('hardware_id').unique(), // CPU serial number (for registration)
  hostname: text('hostname'), // Device hostname from registration
  status: text('status', { enum: deviceStatus }).default('approved'), // Registration status
  ipAddress: text('ip_address'), // Set by heartbeat
  httpPort: integer('http_port').default(8080), // Player's HTTP port
  lastSeen: integer('last_seen', { mode: 'timestamp' }), // Status calculated from this
  currentSong: text('current_song'), // JSON string of current playback
  libraryVersion: integer('library_version').default(0),
  approvedAt: integer('approved_at', { mode: 'timestamp' }), // When device was approved
  reportedPlayerVersion: text('reported_player_version'), // Version reported by heartbeat
  reportedConfigVersion: text('reported_config_version'), // Config version applied
  // Deployment tracking (Ansible push-based)
  lastDeployedAt: integer('last_deployed_at', { mode: 'timestamp' }),
  lastDeployedVersion: text('last_deployed_version'),
  deploymentStatus: text('deployment_status', { enum: deploymentStatus }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

export type Device = typeof devices.$inferSelect
export type NewDevice = typeof devices.$inferInsert

// Download queue (YouTube Music)
export const downloadQueue = sqliteTable('download_queue', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  targetPath: text('target_path'),
  playlistId: integer('playlist_id'), // For adding to playlist after download
  trackPosition: integer('track_position'), // Position in playlist
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

// Deployment run status
export const deploymentRunStatus = [
  'queued',
  'running',
  'success',
  'failed',
] as const
export type DeploymentRunStatus = (typeof deploymentRunStatus)[number]

// Ansible deployment runs
export const deploymentRuns = sqliteTable('deployment_runs', {
  id: integer({ mode: 'number' }).primaryKey({ autoIncrement: true }),
  deviceId: integer('device_id').references(() => devices.id), // null = all devices
  playbook: text('playbook').notNull(), // 'site', 'deploy-player', 'sync-config'
  status: text('status', { enum: deploymentRunStatus }).notNull(),
  output: text('output'), // Ansible output log
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(
    sql`(unixepoch())`,
  ),
})

export type DeploymentRun = typeof deploymentRuns.$inferSelect
export type NewDeploymentRun = typeof deploymentRuns.$inferInsert
