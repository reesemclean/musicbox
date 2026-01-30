import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { parseBuffer } from 'music-metadata'
import { db } from '../db/index.js'
import { downloadQueue, media, playlists, playlistMedia } from '../db/schema.js'
import { getAlbum } from './ytmusicService.js'

const DATA_ROOT = path.join(process.cwd(), 'data')

/**
 * Queue a song for download from YouTube Music
 */
export async function queueDownload(
  videoId: string,
  title: string,
  artist: string,
  album?: string,
  thumbnailUrl?: string,
  playlistId?: number,
  trackPosition?: number
): Promise<{ id: number; videoId: string }> {
  // Check if already in queue
  const existing = await db
    .select()
    .from(downloadQueue)
    .where(eq(downloadQueue.videoId, videoId))
    .limit(1)

  if (existing.length > 0) {
    return { id: existing[0].id, videoId }
  }

  // Add to queue
  const [queueItem] = await db
    .insert(downloadQueue)
    .values({
      videoId,
      title,
      artist,
      album,
      thumbnailUrl,
      playlistId,
      trackPosition,
      status: 'pending',
      progress: 0,
    })
    .returning()

  // Start download in background
  processDownload(queueItem.id)

  return { id: queueItem.id, videoId }
}

/**
 * Process download using yt-dlp
 */
async function processDownload(queueId: number) {
  // Get queue item
  const [item] = await db
    .select()
    .from(downloadQueue)
    .where(eq(downloadQueue.id, queueId))
    .limit(1)

  if (!item) return

  const { videoId, title, artist, album, playlistId, trackPosition } = item

  const songsDir = path.join(DATA_ROOT, 'songs')
  await fs.mkdir(songsDir, { recursive: true })

  // Generate unique filename
  const uuid = crypto.randomUUID()
  const outputPath = path.join(songsDir, `${uuid}.mp3`)

  try {
    // Update status to downloading
    await db
      .update(downloadQueue)
      .set({ status: 'downloading', progress: 0 })
      .where(eq(downloadQueue.id, queueId))

    const url = `https://music.youtube.com/watch?v=${videoId}`

    // yt-dlp command
    const ytdlp = spawn('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--extractor-args', 'youtube:player_client=android',
      '--no-playlist',
      '--output', outputPath.replace('.mp3', '.%(ext)s'),
      '--newline',
      url,
    ])

    ytdlp.stdout.on('data', async (data) => {
      const output = data.toString()
      const progressMatch = output.match(/\[download\]\s+(\d+\.?\d*)%/)
      if (progressMatch) {
        const progress = Math.floor(parseFloat(progressMatch[1]))
        await db
          .update(downloadQueue)
          .set({ progress })
          .where(eq(downloadQueue.id, queueId))
      }
    })

    ytdlp.stderr.on('data', (data) => {
      console.error(`[Download] yt-dlp stderr: ${data}`)
    })

    ytdlp.on('close', async (code) => {
      if (code === 0) {
        try {
          // Read file and extract metadata
          const fileData = await fs.readFile(outputPath)
          const fileStats = await fs.stat(outputPath)

          let duration: number | undefined
          try {
            const metadata = await parseBuffer(fileData, { mimeType: 'audio/mpeg' })
            duration = metadata.format.duration ? Math.round(metadata.format.duration) : undefined
          } catch {
            console.warn('Failed to extract audio metadata')
          }

          // Create media entry
          const [newMedia] = await db.insert(media).values({
            type: 'song',
            title: title,
            duration,
            mimeType: 'audio/mpeg',
            fileSize: fileStats.size,
            filePath: `songs/${uuid}.mp3`,
            metadata: JSON.stringify({
              artist: artist || undefined,
              album: album || undefined,
              youtubeVideoId: videoId,
            }),
          }).returning()

          // Add to playlist if specified
          if (playlistId !== null && playlistId !== undefined && trackPosition !== null && trackPosition !== undefined) {
            await db.insert(playlistMedia).values({
              playlistId,
              mediaId: newMedia.id,
              position: trackPosition,
            })
          }

          // Remove from queue (success)
          await db.delete(downloadQueue).where(eq(downloadQueue.id, queueId))
        } catch (error) {
          console.error('Failed to save song:', error)
          await db
            .update(downloadQueue)
            .set({
              status: 'failed',
              error: `Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`,
            })
            .where(eq(downloadQueue.id, queueId))
        }
      } else {
        await db
          .update(downloadQueue)
          .set({
            status: 'failed',
            error: `yt-dlp exited with code ${code}`,
          })
          .where(eq(downloadQueue.id, queueId))
      }
    })

    ytdlp.on('error', async (error) => {
      await db
        .update(downloadQueue)
        .set({
          status: 'failed',
          error: `Failed to spawn yt-dlp: ${error.message}`,
        })
        .where(eq(downloadQueue.id, queueId))
    })
  } catch (error) {
    await db
      .update(downloadQueue)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      .where(eq(downloadQueue.id, queueId))
  }
}

/**
 * Get download queue status
 */
export async function getDownloadQueueStatus() {
  return await db.select().from(downloadQueue).orderBy(downloadQueue.createdAt)
}

/**
 * Retry a failed download
 */
export async function retryDownload(queueId: number) {
  const [item] = await db
    .select()
    .from(downloadQueue)
    .where(eq(downloadQueue.id, queueId))
    .limit(1)

  if (!item) {
    throw new Error('Download not found')
  }

  if (item.status !== 'failed') {
    throw new Error('Can only retry failed downloads')
  }

  // Reset and retry
  await db
    .update(downloadQueue)
    .set({ status: 'pending', progress: 0, error: null })
    .where(eq(downloadQueue.id, queueId))

  processDownload(queueId)
}

/**
 * Remove from queue
 */
export async function removeFromQueue(queueId: number) {
  await db.delete(downloadQueue).where(eq(downloadQueue.id, queueId))
}

/**
 * Download an entire album and create a playlist
 */
export async function downloadAlbum(browseId: string): Promise<{
  playlistId: number
  albumTitle: string
  trackCount: number
}> {
  // Fetch album details
  const album = await getAlbum(browseId)

  // Create playlist for the album
  const [playlist] = await db
    .insert(playlists)
    .values({ name: `${album.title} - ${album.artist}` })
    .returning()

  // Queue each track for download
  for (let i = 0; i < album.tracks.length; i++) {
    const track = album.tracks[i]
    if (!track.videoId) continue

    await queueDownload(
      track.videoId,
      track.title,
      track.artists.join(', '),
      album.title,
      track.thumbnails?.[0]?.url,
      playlist.id,
      i
    )
  }

  return {
    playlistId: playlist.id,
    albumTitle: album.title,
    trackCount: album.tracks.length,
  }
}
