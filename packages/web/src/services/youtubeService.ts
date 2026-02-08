import { spawn } from 'node:child_process'

export interface YouTubeSearchResult {
  videoId: string
  title: string
  channel: string
  duration: number | null
  thumbnailUrl: string | null
}

/**
 * Search regular YouTube using yt-dlp's built-in ytsearch
 */
export async function searchYouTube(query: string): Promise<YouTubeSearchResult[]> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      '--flat-playlist',
      '--dump-json',
      `ytsearch20:${query}`,
    ])

    let stdout = ''
    let stderr = ''

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp search exited with code ${code}: ${stderr}`))
        return
      }

      try {
        // yt-dlp outputs one JSON object per line
        const results: YouTubeSearchResult[] = stdout
          .trim()
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const entry = JSON.parse(line)
            return {
              videoId: entry.id,
              title: entry.title,
              channel: entry.channel || entry.uploader || 'Unknown',
              duration: entry.duration ?? null,
              thumbnailUrl: entry.thumbnails?.[0]?.url ?? null,
            }
          })
          .filter((r) => r.videoId)

        resolve(results)
      } catch (error) {
        reject(new Error(`Failed to parse yt-dlp search results: ${error}`))
      }
    })

    ytdlp.on('error', (error) => {
      reject(new Error(`Failed to spawn yt-dlp: ${error.message}. Make sure yt-dlp is installed.`))
    })
  })
}
