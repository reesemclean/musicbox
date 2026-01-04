import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { parseBuffer } from 'music-metadata'
import { db } from '@/db'
import { downloadQueue } from '@/db/schema'
import { createSong } from '@/services/songsService'

const LIBRARY_ROOT = path.join(process.cwd(), 'library')

export interface DownloadProgress {
  videoId: string
  progress: number
  status: 'pending' | 'downloading' | 'failed'
  error?: string
}

/**
 * Download a song from YouTube Music using yt-dlp
 */
export async function downloadSong(
  videoId: string,
  title: string,
  artist: string,
  album?: string,
  destination: 'songs' | 'playlist' = 'songs',
  playlistName?: string,
  playlistId?: number,
  trackPosition?: number,
): Promise<string> {
  // Sanitize filename components
  const sanitizedArtist = sanitizeFilename(artist)
  const sanitizedTitle = sanitizeFilename(title)
  const filename = `${sanitizedArtist} - ${sanitizedTitle}.mp3`

  // Determine target directory and path
  let targetDir: string
  let relativePath: string

  if (destination === 'songs') {
    targetDir = path.join(LIBRARY_ROOT, 'songs')
    relativePath = `songs/${filename}`
  } else {
    if (!playlistName) throw new Error('Playlist name required')
    const sanitizedPlaylist = sanitizeFilename(playlistName)
    targetDir = path.join(LIBRARY_ROOT, 'playlists', sanitizedPlaylist)
    relativePath = `playlists/${sanitizedPlaylist}/${filename}`
  }

  // Ensure directory exists
  await fs.mkdir(targetDir, { recursive: true })

  const outputPath = path.join(targetDir, filename)

  // Create download queue entry
  const [queueItem] = await db
    .insert(downloadQueue)
    .values({
      videoId,
      title,
      artist,
      album,
      targetPath: relativePath,
      playlistId: playlistId,
      trackPosition: trackPosition,
      status: 'pending',
      progress: 0,
      addedAt: new Date(),
    })
    .returning()

  // Start download in background
  downloadInBackground(
    videoId,
    outputPath,
    queueItem.id,
    playlistId,
    trackPosition,
  )

  return relativePath
}

/**
 * Download in background and update queue status
 */
async function downloadInBackground(
  videoId: string,
  outputPath: string,
  queueId: number,
  playlistId?: number,
  trackPosition?: number,
) {
  try {
    // Update status to downloading
    await db
      .update(downloadQueue)
      .set({ status: 'downloading', progress: 0 })
      .where(eq(downloadQueue.id, queueId))

    const url = `https://music.youtube.com/watch?v=${videoId}`

    // yt-dlp command with android client workaround and MP3 conversion
    const ytdlp = spawn('yt-dlp', [
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0', // Best quality
      '--extractor-args',
      'youtube:player_client=android',
      '--no-playlist',
      '--output',
      outputPath.replace('.mp3', '.%(ext)s'), // yt-dlp will add .mp3
      '--newline', // Progress on new lines for parsing
      url,
    ])

    ytdlp.stdout.on('data', async (data) => {
      const output = data.toString()

      // Parse progress from yt-dlp output
      // Format: [download]  45.2% of 3.84MiB at 1.23MiB/s ETA 00:02
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
      console.error(`yt-dlp stderr: ${data}`)
    })

    ytdlp.on('close', async (code) => {
      if (code === 0) {
        // Success - read file into buffer and create song entry
        const queueItem = await db
          .select()
          .from(downloadQueue)
          .where(eq(downloadQueue.id, queueId))
          .limit(1)

        if (queueItem[0]) {
          try {
            // Read the downloaded file into a buffer
            const fileData = await fs.readFile(outputPath)
            const fileStats = await fs.stat(outputPath)

            // Extract duration from audio file metadata
            let duration: number | undefined
            try {
              const metadata = await parseBuffer(fileData, {
                mimeType: 'audio/mpeg',
              })
              duration = metadata.format.duration
                ? Math.round(metadata.format.duration)
                : undefined
            } catch (metadataError) {
              console.warn('Failed to extract audio metadata:', metadataError)
            }

            // Create song entry in database with BLOB data
            const newSong = await createSong({
              title: queueItem[0].title,
              artist: queueItem[0].artist || undefined,
              album: queueItem[0].album || undefined,
              duration: duration,
              fileData: fileData,
              mimeType: 'audio/mpeg',
              fileSize: fileStats.size,
              youtubeVideoId: queueItem[0].videoId,
            })

            // If playlist specified, add song to playlist with proper position
            if (playlistId !== undefined && trackPosition !== undefined) {
              const { playlistSongs } = await import('@/db/schema')
              await db.insert(playlistSongs).values({
                playlistId,
                songId: newSong.id,
                position: trackPosition,
              })
            }

            // Remove completed item from queue
            await db.delete(downloadQueue).where(eq(downloadQueue.id, queueId))

            // Delete the downloaded file from filesystem
            await fs.unlink(outputPath)
          } catch (error) {
            console.error('Failed to save song to database:', error)
            await db
              .update(downloadQueue)
              .set({
                status: 'failed',
                error: `Failed to save to database: ${error instanceof Error ? error.message : 'Unknown error'}`,
              })
              .where(eq(downloadQueue.id, queueId))
          }
        }
      } else {
        // Failed - mark as failed but keep in queue for retry
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
export async function getDownloadQueue() {
  return await db.select().from(downloadQueue).orderBy(downloadQueue.addedAt)
}

/**
 * Get download status for a specific video
 */
export async function getDownloadStatus(videoId: string) {
  const [item] = await db
    .select()
    .from(downloadQueue)
    .where(eq(downloadQueue.videoId, videoId))
    .limit(1)

  return item
}

/**
 * Remove a download from the queue
 */
export async function removeFromQueue(queueId: number): Promise<void> {
  await db.delete(downloadQueue).where(eq(downloadQueue.id, queueId))
}

/**
 * Retry a failed download
 */
export async function retryDownload(queueId: number): Promise<void> {
  const items = await db
    .select()
    .from(downloadQueue)
    .where(eq(downloadQueue.id, queueId))
    .limit(1)

  if (items.length === 0) {
    throw new Error('Download not found')
  }

  const item = items[0]

  if (item.status !== 'failed') {
    throw new Error('Can only retry failed downloads')
  }

  // Determine output path
  const sanitizedArtist = sanitizeFilename(item.artist || 'Unknown')
  const sanitizedTitle = sanitizeFilename(item.title)
  const filename = `${sanitizedArtist} - ${sanitizedTitle}.mp3`

  let outputPath: string
  if (item.targetPath?.startsWith('playlists/')) {
    const pathParts = item.targetPath.split('/')
    const playlistName = pathParts[1]
    outputPath = path.join(LIBRARY_ROOT, 'playlists', playlistName, filename)
  } else {
    outputPath = path.join(LIBRARY_ROOT, 'songs', filename)
  }

  // Reset status and retry
  await db
    .update(downloadQueue)
    .set({
      status: 'pending',
      progress: 0,
      error: null,
    })
    .where(eq(downloadQueue.id, queueId))

  // Start download in background with stored playlist info
  downloadInBackground(
    item.videoId,
    outputPath,
    queueId,
    item.playlistId || undefined,
    item.trackPosition || undefined,
  )
}

/**
 * Sanitize filename by removing invalid characters
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '-') // Replace invalid chars with dash
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .substring(0, 100) // Limit length
}
