import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { playlistSongs, playlists, songs } from '@/db/schema'

// Use Drizzle's inferred types from schema
export type Song = typeof songs.$inferSelect
export type SongWithoutBlob = Omit<Song, 'fileData'>
export type NewSong = typeof songs.$inferInsert
export type Playlist = typeof playlists.$inferSelect
export type NewPlaylist = typeof playlists.$inferInsert

export interface PlaylistWithSongs extends Playlist {
  songs: Array<SongWithoutBlob & { position: number }>
}

/**
 * Get all songs from database (without BLOB data for performance)
 */
export async function getAllSongs(): Promise<Array<Omit<Song, 'fileData'>>> {
  return await db
    .select({
      id: songs.id,
      title: songs.title,
      artist: songs.artist,
      album: songs.album,
      duration: songs.duration,
      mimeType: songs.mimeType,
      fileSize: songs.fileSize,
      youtubeVideoId: songs.youtubeVideoId,
      createdAt: songs.createdAt,
    })
    .from(songs)
    .orderBy(desc(songs.createdAt))
}

/**
 * Get a single song by ID
 */
export async function getSongById(id: number): Promise<Song | undefined> {
  const result = await db.select().from(songs).where(eq(songs.id, id)).limit(1)
  return result[0]
}

/**
 * Create a new song entry
 */
export async function createSong(data: {
  title: string
  artist?: string
  album?: string
  duration?: number
  fileData: Buffer
  mimeType: string
  fileSize: number
  youtubeVideoId?: string
}): Promise<Song> {
  const result = await db
    .insert(songs)
    .values({
      title: data.title,
      artist: data.artist || null,
      album: data.album || null,
      duration: data.duration || null,
      fileData: data.fileData,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      youtubeVideoId: data.youtubeVideoId || null,
    })
    .returning()

  return result[0]
}

/**
 * Update a song
 */
export async function updateSong(
  id: number,
  data: Partial<Omit<Song, 'id' | 'createdAt' | 'fileData'>>,
): Promise<Song | undefined> {
  const result = await db
    .update(songs)
    .set(data)
    .where(eq(songs.id, id))
    .returning()
  return result[0]
}

/**
 * Delete a song (removes from DB only - no filesystem)
 */
export async function deleteSong(id: number): Promise<void> {
  await db.delete(songs).where(eq(songs.id, id))
}

/**
 * Get all playlists
 */
export async function getAllPlaylists(): Promise<Array<Playlist>> {
  return await db.select().from(playlists).orderBy(playlists.name)
}

/**
 * Get a playlist by ID with its songs (without BLOB data)
 */
export async function getPlaylistById(
  id: number,
): Promise<PlaylistWithSongs | undefined> {
  const playlist = await db
    .select()
    .from(playlists)
    .where(eq(playlists.id, id))
    .limit(1)

  if (!playlist[0]) return undefined

  const playlistSongsData = await db
    .select({
      song: {
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        album: songs.album,
        duration: songs.duration,
        mimeType: songs.mimeType,
        fileSize: songs.fileSize,
        youtubeVideoId: songs.youtubeVideoId,
        createdAt: songs.createdAt,
      },
      position: playlistSongs.position,
    })
    .from(playlistSongs)
    .innerJoin(songs, eq(playlistSongs.songId, songs.id))
    .where(eq(playlistSongs.playlistId, id))
    .orderBy(playlistSongs.position)

  return {
    ...playlist[0],
    songs: playlistSongsData.map((item) => ({
      ...item.song,
      position: item.position,
    })),
  }
}

/**
 * Create a new playlist
 */
export async function createPlaylist(name: string): Promise<Playlist> {
  const result = await db.insert(playlists).values({ name }).returning()
  return result[0]
}

/**
 * Update a playlist
 */
export async function updatePlaylist(
  id: number,
  data: { name?: string },
): Promise<Playlist | undefined> {
  const result = await db
    .update(playlists)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(playlists.id, id))
    .returning()
  return result[0]
}

/**
 * Delete a playlist
 */
export async function deletePlaylist(id: number): Promise<void> {
  await db.delete(playlists).where(eq(playlists.id, id))
}

/**
 * Add a song to a playlist
 */
export async function addSongToPlaylist(
  playlistId: number,
  songId: number,
): Promise<void> {
  // Get the max position for this playlist
  const existingSongs = await db
    .select()
    .from(playlistSongs)
    .where(eq(playlistSongs.playlistId, playlistId))

  const maxPosition =
    existingSongs.length > 0
      ? Math.max(...existingSongs.map((s) => s.position))
      : -1

  await db.insert(playlistSongs).values({
    playlistId,
    songId,
    position: maxPosition + 1,
  })

  // Update playlist updatedAt
  await db
    .update(playlists)
    .set({ updatedAt: new Date() })
    .where(eq(playlists.id, playlistId))
}

/**
 * Remove a song from a playlist
 */
export async function removeSongFromPlaylist(
  playlistId: number,
  songId: number,
): Promise<void> {
  await db
    .delete(playlistSongs)
    .where(
      and(
        eq(playlistSongs.playlistId, playlistId),
        eq(playlistSongs.songId, songId),
      ),
    )

  // Update playlist updatedAt
  await db
    .update(playlists)
    .set({ updatedAt: new Date() })
    .where(eq(playlists.id, playlistId))
}
