import { createServerFn } from '@tanstack/react-start'
import { searchSongs, getAlbum } from './ytmusicService'
import {
  downloadSong,
  getDownloadQueue,
  getDownloadStatus,
  clearCompletedDownloads,
} from './downloadService'

// ============================================================================
// YouTube Music Search
// ============================================================================

export const searchYTMusic = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }) => {
    if (!data.query || data.query.trim().length === 0) {
      throw new Error('Query is required')
    }

    return await searchSongs(data.query)
  })

export const getYTMusicAlbum = createServerFn({ method: 'GET' })
  .inputValidator((data: { browseId: string }) => data)
  .handler(async ({ data }) => {
    if (!data.browseId) {
      throw new Error('Browse ID is required')
    }

    return await getAlbum(data.browseId)
  })

// ============================================================================
// Download Management
// ============================================================================

export const downloadYTMusicSong = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      videoId: string
      title: string
      artist: string
      album?: string
      destination?: 'songs' | 'playlist'
      playlistName?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    if (!data.videoId || !data.title || !data.artist) {
      throw new Error('videoId, title, and artist are required')
    }

    const relativePath = await downloadSong(
      data.videoId,
      data.title,
      data.artist,
      data.album,
      data.destination || 'songs',
      data.playlistName,
    )

    return {
      success: true,
      path: relativePath,
      message: 'Download started',
    }
  })

export const getDownloadQueueStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    return await getDownloadQueue()
  },
)

export const getVideoDownloadStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: { videoId: string }) => data)
  .handler(async ({ data }) => {
    if (!data.videoId) {
      throw new Error('videoId is required')
    }

    return await getDownloadStatus(data.videoId)
  })

export const clearCompleted = createServerFn({ method: 'POST' }).handler(
  async () => {
    await clearCompletedDownloads()
    return { success: true }
  },
)
