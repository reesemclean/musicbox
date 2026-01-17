import { createServerFn } from '@tanstack/react-start'
import { getAlbum, searchAlbums, searchSongs } from './ytmusicService'
import {
  downloadSong,
  getDownloadQueue,
  getDownloadStatus,
  removeFromQueue,
  retryDownload,
} from './downloadService'
import { createPlaylist } from './songsService'

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

export const searchYTMusicAlbums = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string }) => data)
  .handler(async ({ data }) => {
    if (!data.query || data.query.trim().length === 0) {
      throw new Error('Query is required')
    }

    return await searchAlbums(data.query)
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

export const downloadYTMusicAlbum = createServerFn({ method: 'POST' })
  .inputValidator((data: { browseId: string; createPlaylist: boolean }) => data)
  .handler(async ({ data }) => {
    if (!data.browseId) {
      throw new Error('Browse ID is required')
    }

    // Get album details
    const album = await getAlbum(data.browseId)

    // Create playlist if requested
    let playlistName: string | undefined
    let playlistId: number | undefined
    if (data.createPlaylist) {
      playlistName = `${album.title} - ${album.artist}`
      const playlist = await createPlaylist(playlistName)
      playlistId = playlist.id
    }

    // Queue all tracks for download with proper track positions
    for (let i = 0; i < album.tracks.length; i++) {
      const track = album.tracks[i]
      await downloadSong(
        track.videoId,
        track.title,
        track.artists.join(', '),
        album.title,
        data.createPlaylist ? 'playlist' : 'songs',
        playlistName,
        playlistId,
        i, // Track position in album order
      )
    }

    return {
      success: true,
      albumTitle: album.title,
      trackCount: album.tracks.length,
      playlistCreated: data.createPlaylist,
      message: `Started downloading ${album.tracks.length} tracks`,
    }
  })

export const getYTMusicDownloadStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: { videoId: string }) => data)
  .handler(async ({ data }) => {
    if (!data.videoId) {
      throw new Error('videoId is required')
    }

    return await getDownloadStatus(data.videoId)
  })

export const retryFailedDownload = createServerFn({ method: 'POST' })
  .inputValidator((data: { queueId: number }) => data)
  .handler(async ({ data }) => {
    if (!data.queueId) {
      throw new Error('Queue ID is required')
    }

    await retryDownload(data.queueId)

    return {
      success: true,
      message: 'Download retry started',
    }
  })

export const removeDownloadFromQueue = createServerFn({ method: 'POST' })
  .inputValidator((data: { queueId: number }) => data)
  .handler(async ({ data }) => {
    if (!data.queueId) {
      throw new Error('Queue ID is required')
    }

    await removeFromQueue(data.queueId)

    return {
      success: true,
      message: 'Download removed from queue',
    }
  })
