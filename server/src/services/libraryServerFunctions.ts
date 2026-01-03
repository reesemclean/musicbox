import { createServerFn } from '@tanstack/react-start'
import { getLibrary, getPlaylists, getSongs } from '@/services/libraryService'

// ============================================================================
// Library Operations
// ============================================================================

export const getLibraryContents = createServerFn().handler(async () => {
  return getLibrary()
})

export const getAllSongs = createServerFn().handler(async () => {
  return getSongs()
})

export const getAllPlaylists = createServerFn().handler(async () => {
  return getPlaylists()
})

// ============================================================================
// File Upload
// ============================================================================

export const uploadSong = createServerFn({ method: 'POST' })
  .inputValidator((data) => {
    if (!(data instanceof FormData)) {
      throw new Error('Expected FormData')
    }

    const file = data.get('file')
    if (!file || !(file instanceof File)) {
      throw new Error('No file provided')
    }

    if (!file.name.match(/\.(mp3|m4a|flac|wav|ogg)$/i)) {
      throw new Error('Invalid file type. Only audio files are allowed.')
    }

    return {
      file,
      destination: (data.get('destination')?.toString() || 'songs') as
        | 'songs'
        | 'playlist',
      playlistName: data.get('playlistName')?.toString(),
    }
  })
  .handler(async ({ data }) => {
    // Sanitize filename
    const sanitized = data.file.name
      .replace(/[^a-zA-Z0-9._\s-]/g, '')
      .substring(0, 255)

    const buffer = await data.file.arrayBuffer()

    // Use the library service to save the file
    const { promises: fs } = await import('node:fs')
    const path = await import('node:path')

    const LIBRARY_ROOT = path.join(process.cwd(), 'library')
    let targetDir: string
    let relativePath: string

    if (data.destination === 'songs') {
      targetDir = path.join(LIBRARY_ROOT, 'songs')
      relativePath = `songs/${sanitized}`
    } else {
      if (!data.playlistName) {
        throw new Error('Playlist name required')
      }
      targetDir = path.join(LIBRARY_ROOT, 'playlists', data.playlistName)
      relativePath = `playlists/${data.playlistName}/${sanitized}`
    }

    // Ensure directory exists
    await fs.mkdir(targetDir, { recursive: true })

    // Write file
    const filePath = path.join(targetDir, sanitized)
    await fs.writeFile(filePath, Buffer.from(buffer))

    return {
      success: true,
      path: relativePath,
      filename: sanitized,
      size: data.file.size,
    }
  })

// ============================================================================
// Playlist Management
// ============================================================================

export const createPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const { promises: fs } = await import('node:fs')
    const path = await import('node:path')

    const LIBRARY_ROOT = path.join(process.cwd(), 'library')

    // Sanitize playlist name
    const sanitized = data.name
      .replace(/[^a-zA-Z0-9._\s-]/g, '')
      .substring(0, 255)

    const playlistDir = path.join(LIBRARY_ROOT, 'playlists', sanitized)
    await fs.mkdir(playlistDir, { recursive: true })

    return {
      success: true,
      path: `playlists/${sanitized}`,
      name: sanitized,
    }
  })

export const deletePlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistName: string }) => data)
  .handler(async ({ data }) => {
    const { promises: fs } = await import('node:fs')
    const path = await import('node:path')

    const LIBRARY_ROOT = path.join(process.cwd(), 'library')
    const playlistDir = path.join(LIBRARY_ROOT, 'playlists', data.playlistName)

    await fs.rm(playlistDir, { recursive: true, force: true })

    return { success: true }
  })
