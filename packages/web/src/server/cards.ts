import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { cards } from '../db/schema.js'

export const getCards = createServerFn({ method: 'GET' })
  .handler(async () => {
    return db.select().from(cards)
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

export const deleteCard = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [deleted] = await db.delete(cards).where(eq(cards.id, data.id)).returning()
    if (!deleted) throw new Error('Card not found')

    return { success: true }
  })
