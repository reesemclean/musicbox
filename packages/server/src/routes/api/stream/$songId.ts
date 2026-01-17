import { createFileRoute } from '@tanstack/react-router'
import { getSongById } from '@/services/songsService'

export const Route = createFileRoute('/api/stream/$songId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const songId = parseInt(params.songId, 10)

        if (isNaN(songId)) {
          return new Response('Invalid song ID', { status: 400 })
        }

        const song = await getSongById(songId)

        if (!song) {
          return new Response('Song not found', { status: 404 })
        }

        // Convert Buffer to Uint8Array for Response
        const audioData = new Uint8Array(song.fileData)

        // Return the audio file with appropriate headers for streaming
        return new Response(audioData, {
          headers: {
            'Content-Type': song.mimeType,
            'Content-Length': song.fileSize.toString(),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
          },
        })
      },
    },
  },
})
