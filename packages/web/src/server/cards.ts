import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { cards, media, playlists, podcastFeeds } from '../db/schema.js'

export const getCards = createServerFn({ method: 'GET' })
  .handler(async () => {
    return db.select().from(cards)
  })

export const getCardById = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [card] = await db.select().from(cards).where(eq(cards.id, data.id)).limit(1)
    if (!card) throw new Error('Card not found')
    return card
  })

interface CreateCardData {
  uid: string
  name?: string
  volume?: number
  type: 'media' | 'playlist' | 'podcast'
  mediaId?: number
  playlistId?: number
  podcastFeedId?: number
}

export const createCard = createServerFn({ method: 'POST' })
  .inputValidator((data: CreateCardData) => data)
  .handler(async ({ data }) => {
    const values: typeof cards.$inferInsert = {
      uid: data.uid,
      name: data.name,
      volume: data.volume,
    }

    switch (data.type) {
      case 'media':
        values.mediaId = data.mediaId
        break
      case 'playlist':
        values.playlistId = data.playlistId
        break
      case 'podcast':
        values.podcastFeedId = data.podcastFeedId
        break
    }

    const [created] = await db.insert(cards).values(values).returning()

    return created
  })

interface UpdateCardData {
  id: number
  name?: string
  volume?: number | null
  type: 'media' | 'playlist' | 'podcast'
  mediaId?: number
  playlistId?: number
  podcastFeedId?: number
}

export const updateCard = createServerFn({ method: 'POST' })
  .inputValidator((data: UpdateCardData) => data)
  .handler(async ({ data }) => {
    const { id, ...rest } = data

    const values: Partial<typeof cards.$inferInsert> = {
      name: rest.name,
      volume: rest.volume,
      mediaId: null,
      playlistId: null,
      podcastFeedId: null,
    }

    switch (rest.type) {
      case 'media':
        values.mediaId = rest.mediaId
        break
      case 'playlist':
        values.playlistId = rest.playlistId
        break
      case 'podcast':
        values.podcastFeedId = rest.podcastFeedId
        break
    }

    const [updated] = await db
      .update(cards)
      .set(values)
      .where(eq(cards.id, id))
      .returning()

    if (!updated) throw new Error('Card not found')

    return updated
  })

export const deleteCard = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [deleted] = await db.delete(cards).where(eq(cards.id, data.id)).returning()
    if (!deleted) throw new Error('Card not found')

    return { success: true }
  })

// Card lookup with content (used by UI to show card details)
export const getCardWithContent = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [card] = await db.select().from(cards).where(eq(cards.id, data.id)).limit(1)
    if (!card) throw new Error('Card not found')

    let content: { type: string; item?: object } = { type: 'unmapped' }

    if (card.mediaId) {
      const [item] = await db.select().from(media).where(eq(media.id, card.mediaId)).limit(1)
      content = { type: 'media', item }
    } else if (card.playlistId) {
      const [item] = await db.select().from(playlists).where(eq(playlists.id, card.playlistId)).limit(1)
      content = { type: 'playlist', item }
    } else if (card.podcastFeedId) {
      const [item] = await db.select().from(podcastFeeds).where(eq(podcastFeeds.id, card.podcastFeedId)).limit(1)
      content = { type: 'podcast', item }
    }

    return { card, content }
  })
