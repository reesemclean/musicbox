import { createFileRoute } from '@tanstack/react-router'
import { getEpisodeWithFileData, markEpisodeListened } from '@/services/podcastService'

export const Route = createFileRoute('/api/stream/episode/$episodeId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const episodeId = parseInt(params.episodeId, 10)

        if (isNaN(episodeId)) {
          return new Response('Invalid episode ID', { status: 400 })
        }

        const episode = await getEpisodeWithFileData(episodeId)

        if (!episode) {
          return new Response('Episode not found', { status: 404 })
        }

        if (!episode.fileData) {
          return new Response('Episode not yet downloaded', { status: 404 })
        }

        // Mark episode as listened (fire and forget)
        markEpisodeListened(episodeId).catch(() => {
          // Ignore errors - this is non-critical
        })

        // Convert Buffer to Uint8Array for Response
        const audioData = new Uint8Array(episode.fileData)

        // Return the audio file with appropriate headers for streaming
        return new Response(audioData, {
          headers: {
            'Content-Type': episode.mimeType || 'audio/mpeg',
            'Content-Length': (episode.fileSize || audioData.length).toString(),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=3600', // Cache for 1 hour (episodes may be removed)
          },
        })
      },
    },
  },
})
