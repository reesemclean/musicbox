import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db/index.js'
import { cards, media, playlists, podcastFeeds } from '@/db/schema.js'

export const Route = createFileRoute('/api/cards/lookup/$uid')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { uid } = params

        if (!uid) {
          return Response.json({ error: 'UID is required' }, { status: 400 })
        }

        const [card] = await db.select().from(cards).where(eq(cards.uid, uid)).limit(1)

        if (!card) {
          return Response.json({ error: 'Card not found', uid }, { status: 404 })
        }

        const response: {
          type: 'media' | 'playlist' | 'podcast' | 'unmapped'
          card: typeof card
          volume?: number | null
          media?: typeof media.$inferSelect
          playlist?: typeof playlists.$inferSelect
          feed?: typeof podcastFeeds.$inferSelect
        } = {
          type: 'unmapped',
          card,
          volume: card.volume,
        }

        if (card.mediaId) {
          const [mediaItem] = await db.select().from(media).where(eq(media.id, card.mediaId)).limit(1)
          response.type = 'media'
          response.media = mediaItem
        } else if (card.playlistId) {
          const [playlist] = await db.select().from(playlists).where(eq(playlists.id, card.playlistId)).limit(1)
          response.type = 'playlist'
          response.playlist = playlist
        } else if (card.podcastFeedId) {
          const [feed] = await db.select().from(podcastFeeds).where(eq(podcastFeeds.id, card.podcastFeedId)).limit(1)
          response.type = 'podcast'
          response.feed = feed
        }

        return Response.json(response)
      },
    },
  },
})
