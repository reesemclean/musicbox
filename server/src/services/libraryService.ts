import { promises as fs } from 'node:fs'
import path from 'node:path'

const LIBRARY_ROOT = path.join(process.cwd(), 'library')

export interface SongFile {
  path: string
  filename: string
  size: number
  type: 'song'
}

export interface PlaylistFolder {
  path: string
  name: string
  songs: Array<SongFile>
  type: 'playlist'
}

export interface LibraryContents {
  songs: Array<SongFile>
  playlists: Array<PlaylistFolder>
}

/**
 * Ensure library directories exist
 */
export async function ensureLibraryDirs() {
  const songsDir = path.join(LIBRARY_ROOT, 'songs')
  const playlistsDir = path.join(LIBRARY_ROOT, 'playlists')

  try {
    await fs.mkdir(songsDir, { recursive: true })
    await fs.mkdir(playlistsDir, { recursive: true })
  } catch (error) {
    console.error('Failed to create library directories:', error)
    throw error
  }
}

/**
 * Get all songs from library/songs
 */
export async function getSongs(): Promise<Array<SongFile>> {
  const songsDir = path.join(LIBRARY_ROOT, 'songs')

  try {
    const files = await fs.readdir(songsDir, { withFileTypes: true })

    const songs: Array<SongFile> = []
    for (const file of files) {
      if (file.isFile() && isMusicFile(file.name)) {
        const filePath = path.join(songsDir, file.name)
        const stats = await fs.stat(filePath)
        songs.push({
          path: `songs/${file.name}`,
          filename: file.name,
          size: stats.size,
          type: 'song',
        })
      }
    }

    return songs.sort((a, b) => a.filename.localeCompare(b.filename))
  } catch (error) {
    console.error('Failed to read songs:', error)
    return []
  }
}

/**
 * Get all playlists and their songs
 */
export async function getPlaylists(): Promise<Array<PlaylistFolder>> {
  const playlistsDir = path.join(LIBRARY_ROOT, 'playlists')

  try {
    const items = await fs.readdir(playlistsDir, { withFileTypes: true })

    const playlists: Array<PlaylistFolder> = []
    for (const item of items) {
      if (item.isDirectory()) {
        const playlistPath = path.join(playlistsDir, item.name)
        const files = await fs.readdir(playlistPath, { withFileTypes: true })

        const songs: Array<SongFile> = []
        for (const file of files) {
          if (file.isFile() && isMusicFile(file.name)) {
            const filePath = path.join(playlistPath, file.name)
            const stats = await fs.stat(filePath)
            songs.push({
              path: `playlists/${item.name}/${file.name}`,
              filename: file.name,
              size: stats.size,
              type: 'song',
            })
          }
        }

        playlists.push({
          path: `playlists/${item.name}`,
          name: item.name,
          songs: songs.sort((a, b) => a.filename.localeCompare(b.filename)),
          type: 'playlist',
        })
      }
    }

    return playlists.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    console.error('Failed to read playlists:', error)
    return []
  }
}

/**
 * Get complete library contents (songs + playlists)
 */
export async function getLibrary(): Promise<LibraryContents> {
  await ensureLibraryDirs()
  const [songs, playlists] = await Promise.all([getSongs(), getPlaylists()])
  return { songs, playlists }
}

/**
 * Check if file is a music file
 */
function isMusicFile(filename: string): boolean {
  const musicExtensions = ['.mp3', '.m4a', '.flac', '.wav', '.ogg']
  const ext = path.extname(filename).toLowerCase()
  return musicExtensions.includes(ext)
}

/**
 * Get absolute path for a library file
 */
export function getLibraryFilePath(relativePath: string): string {
  const fullPath = path.resolve(path.join(LIBRARY_ROOT, relativePath))
  // Security: ensure path is within library
  if (!fullPath.startsWith(path.resolve(LIBRARY_ROOT))) {
    throw new Error('Invalid path')
  }
  return fullPath
}

/**
 * Save uploaded file to library
 */
export async function saveUploadedFile(
  filename: string,
  buffer: Buffer,
  destination: 'songs' | 'playlist' = 'songs',
  playlistName?: string,
): Promise<string> {
  // Sanitize filename
  const sanitized = filename.replace(/[^a-zA-Z0-9._\s-]/g, '').substring(0, 255)

  let targetDir: string
  let relativePath: string

  if (destination === 'songs') {
    targetDir = path.join(LIBRARY_ROOT, 'songs')
    relativePath = `songs/${sanitized}`
  } else {
    if (!playlistName) throw new Error('Playlist name required')
    targetDir = path.join(LIBRARY_ROOT, 'playlists', playlistName)
    relativePath = `playlists/${playlistName}/${sanitized}`
  }

  // Ensure directory exists
  await fs.mkdir(targetDir, { recursive: true })

  const filePath = path.join(targetDir, sanitized)
  await fs.writeFile(filePath, buffer)

  return relativePath
}

/**
 * Delete a library file
 */
export async function deleteLibraryFile(relativePath: string): Promise<void> {
  const filePath = getLibraryFilePath(relativePath)
  await fs.unlink(filePath)
}

/**
 * Create a new playlist
 */
export async function createPlaylist(name: string): Promise<string> {
  // Sanitize playlist name
  const sanitized = name.replace(/[^a-zA-Z0-9._\s-]/g, '').substring(0, 255)

  const playlistDir = path.join(LIBRARY_ROOT, 'playlists', sanitized)
  await fs.mkdir(playlistDir, { recursive: true })

  return `playlists/${sanitized}`
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(playlistName: string): Promise<void> {
  const playlistDir = path.join(LIBRARY_ROOT, 'playlists', playlistName)
  await fs.rm(playlistDir, { recursive: true, force: true })
}
