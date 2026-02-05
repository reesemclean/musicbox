import { createServerFn } from '@tanstack/react-start'
import { searchSongs, searchAlbums } from '../services/ytmusicService.js'
import {
  queueDownload,
  getDownloadQueueStatus,
  retryDownload,
  removeFromQueue,
  downloadAlbum,
} from '../services/downloadService.js'

export const search = createServerFn({ method: 'GET' })
  .inputValidator((data: { query: string; type?: 'songs' | 'albums' }) => data)
  .handler(async ({ data }) => {
    if (data.type === 'albums') {
      return searchAlbums(data.query)
    }
    return searchSongs(data.query)
  })

export const queueSongDownload = createServerFn({ method: 'POST' })
  .inputValidator((data: {
    videoId: string
    title: string
    artist: string
    album?: string
    thumbnailUrl?: string
  }) => data)
  .handler(async ({ data }) => {
    return queueDownload(
      data.videoId,
      data.title,
      data.artist,
      data.album,
      data.thumbnailUrl
    )
  })

export const queueAlbumDownload = createServerFn({ method: 'POST' })
  .inputValidator((data: { browseId: string }) => data)
  .handler(async ({ data }) => {
    return downloadAlbum(data.browseId)
  })

export const getQueue = createServerFn({ method: 'GET' })
  .handler(async () => {
    return getDownloadQueueStatus()
  })

export const retryQueuedDownload = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await retryDownload(data.id)
    return { success: true }
  })

export const removeFromDownloadQueue = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await removeFromQueue(data.id)
    return { success: true }
  })
