import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import type { InferSelectModel } from 'drizzle-orm'

// Metadata type for media items (stored as JSON)
export interface MediaMetadata {
  // Song metadata
  artist?: string | null
  album?: string | null
  trackNumber?: number | null
  year?: number | null
  youtubeVideoId?: string | null
  // Podcast metadata
  showName?: string | null
  episodeNumber?: number | null
  publishedAt?: string | null
  pubDate?: string | null
  description?: string | null
  feedId?: number | null
  guid?: string | null
  audioUrl?: string | null
  downloadStatus?: 'pending' | 'downloading' | 'complete' | 'failed' | null
  // Sound machine metadata
  category?: string | null
  looping?: boolean | null
  system?: boolean | null
}

export const media = sqliteTable('media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type', { enum: ['song', 'podcast', 'soundmachine'] }).notNull(),
  title: text('title').notNull(),
  duration: integer('duration'), // in seconds
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  filePath: text('file_path').notNull(),
  metadata: text('metadata', { mode: 'json' }).$type<MediaMetadata>(), // type-specific: artist, album, showName, etc.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const podcastFeeds = sqliteTable('podcast_feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  feedUrl: text('feed_url').notNull().unique(),
  imageUrl: text('image_url'),
  retentionCount: integer('retention_count').notNull().default(3),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
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

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull().unique(), // NFC card UID (hex string)
  name: text('name'), // friendly name

  // Content - only one should be set
  mediaId: integer('media_id').references(() => media.id, { onDelete: 'cascade' }),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'cascade' }),
  podcastFeedId: integer('podcast_feed_id').references(() => podcastFeeds.id, { onDelete: 'cascade' }),

  // Playback settings
  volume: integer('volume'), // 0-21, null = use current volume

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
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
  soundMachineVolume: integer('sound_machine_volume'), // 0-21, null = use current volume
  maxVolume: integer('max_volume'), // 0-42, null = no limit (default 42)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

export const downloadQueue = sqliteTable('download_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  videoId: text('video_id').notNull().unique(),
  title: text('title').notNull(),
  artist: text('artist'),
  album: text('album'),
  thumbnailUrl: text('thumbnail_url'),
  playlistId: integer('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
  trackPosition: integer('track_position'),
  status: text('status', { enum: ['pending', 'downloading', 'failed'] }).notNull().default('pending'),
  progress: integer('progress').notNull().default(0),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})

// Type exports
export type Media = InferSelectModel<typeof media>
export type Playlist = InferSelectModel<typeof playlists>
export type PlaylistMedia = InferSelectModel<typeof playlistMedia>
export type Card = InferSelectModel<typeof cards>
export type Device = InferSelectModel<typeof devices>
export type PodcastFeed = InferSelectModel<typeof podcastFeeds>
export type DownloadQueueItem = InferSelectModel<typeof downloadQueue>
