// Shared types between server and player

export type ContentType = 'song' | 'playlist' | 'action' | 'podcast'

export type Action = 'play' | 'pause' | 'next' | 'previous' | 'stop'

export interface CardMapping {
  id: number
  nfcId: string
  contentType: ContentType
  contentPath?: string | null
  action?: Action | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface Device {
  id: number
  name: string
  ipAddress?: string | null
  lastSeen: Date
  libraryVersion: number
}

export interface Song {
  path: string
  filename: string
  title: string
  artist?: string
  album?: string
}

export interface Playlist {
  name: string
  path: string
  tracks: Song[]
}

export interface LibraryVersion {
  id: number
  version: number
  updatedAt: Date
  changeDescription?: string | null
}

export interface DownloadQueue {
  id: number
  videoId: string
  title: string
  artist?: string | null
  album?: string | null
  targetPath?: string | null
  status: 'pending' | 'downloading' | 'complete' | 'failed'
  progress: number
  error?: string | null
  addedAt: Date
  completedAt?: Date | null
}

export interface PlayHistory {
  id: number
  deviceId: number
  songPath: string
  playedAt: Date
}

// NFC Scan API Response Types
export interface SongContent {
  id: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  mimeType: string
  fileSize: number
}

export interface PlaylistContent {
  id: number
  name: string
  createdAt: Date | null
  updatedAt: Date | null
  songs: Array<{
    position: number
    id: number
    title: string
    artist?: string | null
    album?: string | null
    duration?: number | null
    mimeType: string
    fileSize: number
  }>
}

// Podcast episode content
export interface EpisodeContent {
  id: number
  feedId: number
  title: string
  description?: string | null
  duration?: number | null
  publishedAt?: Date | null
  mimeType?: string | null
  fileSize?: number | null
  downloadStatus: 'pending' | 'downloading' | 'complete' | 'failed'
}

// Podcast feed content
export interface PodcastContent {
  id: number
  title: string
  description?: string | null
  imageUrl?: string | null
  author?: string | null
  latestEpisode: EpisodeContent | null
}

export interface NFCScanResponse {
  success: true
  nfcId: string
  contentType: ContentType
  content:
    | { type: 'song'; song: SongContent }
    | { type: 'playlist'; playlist: PlaylistContent }
    | { type: 'action'; action: Action }
    | { type: 'podcast'; podcast: PodcastContent }
    | null
}

export interface NFCScanErrorResponse {
  error: string
  nfcId?: string
}
