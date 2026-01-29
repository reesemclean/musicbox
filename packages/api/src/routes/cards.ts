import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { cards, media, playlists, podcastFeeds } from '../db/schema.js'

export const cardRoutes = new Hono()

// Validation schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const uidParamSchema = z.object({
  uid: z.string().min(1),
})

// Type-specific discriminators (shared between create/update)
const mediaTypeSchema = z.object({
  type: z.literal('media'),
  mediaId: z.number(),
})

const playlistTypeSchema = z.object({
  type: z.literal('playlist'),
  playlistId: z.number(),
})

const podcastTypeSchema = z.object({
  type: z.literal('podcast'),
  podcastFeedId: z.number(),
})

// Create schema
const createBaseSchema = z.object({
  uid: z.string().min(1),
  name: z.string().optional(),
  volume: z.number().min(0).max(21).optional(),
})

const createCardSchema = z.discriminatedUnion('type', [
  createBaseSchema.merge(mediaTypeSchema),
  createBaseSchema.merge(playlistTypeSchema),
  createBaseSchema.merge(podcastTypeSchema),
])

// Update schema
const updateBaseSchema = z.object({
  name: z.string().optional(),
  volume: z.number().min(0).max(21).nullable().optional(),
})

const updateCardSchema = z.discriminatedUnion('type', [
  updateBaseSchema.merge(mediaTypeSchema),
  updateBaseSchema.merge(playlistTypeSchema),
  updateBaseSchema.merge(podcastTypeSchema),
])

// List all cards
cardRoutes.get('/', async (c) => {
  const items = await db.select().from(cards)
  return c.json(items)
})

// Lookup card by UID (used by ESP32)
cardRoutes.get(
  '/lookup/:uid',
  zValidator('param', uidParamSchema),
  async (c) => {
    const { uid } = c.req.valid('param')

    const [card] = await db.select().from(cards).where(eq(cards.uid, uid)).limit(1)

    if (!card) {
      return c.json({ error: 'Card not found', uid }, 404)
    }

    // Build response based on what the card maps to
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
      // TODO: Resolve to newest episode once podcastEpisodeFeeds linking table is added
      const [feed] = await db.select().from(podcastFeeds).where(eq(podcastFeeds.id, card.podcastFeedId)).limit(1)
      response.type = 'podcast'
      response.feed = feed
    }

    return c.json(response)
  }
)

// Get single card
cardRoutes.get(
  '/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [card] = await db.select().from(cards).where(eq(cards.id, id)).limit(1)

    if (!card) {
      return c.json({ error: 'Card not found' }, 404)
    }

    return c.json(card)
  }
)

// Create card
cardRoutes.post(
  '/',
  zValidator('json', createCardSchema),
  async (c) => {
    const data = c.req.valid('json')

    // Map discriminated union to DB columns
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

    return c.json(created, 201)
  }
)

// Update card
cardRoutes.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updateCardSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')

    // Map discriminated union to DB columns, clearing others
    const values: Partial<typeof cards.$inferInsert> = {
      name: data.name,
      volume: data.volume,
      mediaId: null,
      playlistId: null,
      podcastFeedId: null,
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

    const [updated] = await db
      .update(cards)
      .set(values)
      .where(eq(cards.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Card not found' }, 404)
    }

    return c.json(updated)
  }
)

// Delete card
cardRoutes.delete(
  '/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [deleted] = await db.delete(cards).where(eq(cards.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Card not found' }, 404)
    }

    return c.json({ success: true })
  }
)
