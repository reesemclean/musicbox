import { createServerFn } from '@tanstack/react-start'
import {
  addSongToPlaylist,
  createPlaylist,
  createSong,
  deletePlaylist,
  deleteSong,
  getAllPlaylists,
  getAllSongs,
  getPlaylistById,
  getSongById,
  getSongMetadata,
  removeSongFromPlaylist,
  updatePlaylist,
  updateSong,
} from '@/services/songsService'

// ============================================================================
// Songs
// ============================================================================

export const getSongs = createServerFn().handler(async () => {
  return await getAllSongs()
})

export const getSong = createServerFn()
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    return await getSongById(data.id)
  })

export const getSongMeta = createServerFn()
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    return await getSongMetadata(data.id)
  })

export const addSong = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      title: string
      artist?: string
      album?: string
      duration?: number
      fileData: Buffer
      mimeType: string
      fileSize: number
      youtubeVideoId?: string
    }) => data,
  )
  .handler(async ({ data }) => {
    return await createSong(data)
  })

export const editSong = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      id: number
      title?: string
      artist?: string
      album?: string
      duration?: number
    }) => data,
  )
  .handler(async ({ data }) => {
    const { id, ...updates } = data
    return await updateSong(id, updates)
  })

export const removeSong = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await deleteSong(data.id)
    return { success: true }
  })

// ============================================================================
// Playlists
// ============================================================================

export const getPlaylists = createServerFn().handler(async () => {
  return await getAllPlaylists()
})

export const getPlaylist = createServerFn()
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    return await getPlaylistById(data.id)
  })

export const addPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    return await createPlaylist(data.name)
  })

export const editPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; name: string }) => data)
  .handler(async ({ data }) => {
    return await updatePlaylist(data.id, { name: data.name })
  })

export const removePlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await deletePlaylist(data.id)
    return { success: true }
  })

// ============================================================================
// Playlist Songs
// ============================================================================

export const addSongToPlaylistFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistId: number; songId: number }) => data)
  .handler(async ({ data }) => {
    await addSongToPlaylist(data.playlistId, data.songId)
    return { success: true }
  })

export const removeSongFromPlaylistFn = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistId: number; songId: number }) => data)
  .handler(async ({ data }) => {
    await removeSongFromPlaylist(data.playlistId, data.songId)
    return await removeSongFromPlaylist(data.playlistId, data.songId)
  })

// ============================================================================
// Audio Streaming
// ============================================================================

export const streamSong = createServerFn()
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const song = await getSongById(data.id)

    if (!song) {
      throw new Error('Song not found')
    }

    // Return song data for streaming
    return {
      fileData: song.fileData.toString('base64'),
      mimeType: song.mimeType,
      fileSize: song.fileSize,
    }
  })
