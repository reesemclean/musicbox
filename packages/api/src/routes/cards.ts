import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { cards, media, playlists, podcastFeeds } from '../db/schema.js'
import { mediaTypeSchema } from '../types/media.js'

export const cardRoutes = new Hono()

// Schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const uidParamSchema = z.object({
  uid: z.string().min(1),
})

const mediaTypeDiscriminator = z.object({
  type: z.literal('media'),
  mediaId: z.number(),
})

const playlistTypeDiscriminator = z.object({
  type: z.literal('playlist'),
  playlistId: z.number(),
})

const podcastTypeDiscriminator = z.object({
  type: z.literal('podcast'),
  podcastFeedId: z.number(),
})

const createBaseSchema = z.object({
  uid: z.string().min(1),
  name: z.string().optional(),
  volume: z.number().min(0).max(21).optional(),
})

const createCardSchema = z.discriminatedUnion('type', [
  createBaseSchema.merge(mediaTypeDiscriminator),
  createBaseSchema.merge(playlistTypeDiscriminator),
  createBaseSchema.merge(podcastTypeDiscriminator),
])

const updateBaseSchema = z.object({
  name: z.string().optional(),
  volume: z.number().min(0).max(21).nullable().optional(),
})

const updateCardSchema = z.discriminatedUnion('type', [
  updateBaseSchema.merge(mediaTypeDiscriminator),
  updateBaseSchema.merge(playlistTypeDiscriminator),
  updateBaseSchema.merge(podcastTypeDiscriminator),
])

const cardSchema = z.object({
  id: z.number(),
  uid: z.string(),
  name: z.string().nullable(),
  mediaId: z.number().nullable(),
  playlistId: z.number().nullable(),
  podcastFeedId: z.number().nullable(),
  volume: z.number().nullable(),
  createdAt: z.string().datetime(),
})

const responseMediaSchema = z.object({
  id: z.number(),
  type: mediaTypeSchema,
  title: z.string(),
  duration: z.number().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  filePath: z.string(),
  metadata: z.unknown().nullable(),
  createdAt: z.string().datetime(),
})

const playlistSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string().datetime(),
})

const podcastFeedSchema = z.object({
  id: z.number(),
  name: z.string(),
  feedUrl: z.string(),
  imageUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
})

const cardLookupResponseSchema = z.object({
  type: z.enum(['media', 'playlist', 'podcast', 'unmapped']),
  card: cardSchema,
  volume: z.number().nullable().optional(),
  media: responseMediaSchema.optional(),
  playlist: playlistSchema.optional(),
  feed: podcastFeedSchema.optional(),
})

const errorSchema = z.object({
  error: z.string(),
})

const successSchema = z.object({
  success: z.boolean(),
})

// List all cards
cardRoutes.get(
  '/',
  describeRoute({
    tags: ['Cards'],
    summary: 'List all cards',
    responses: {
      200: {
        description: 'List of cards',
        content: { 'application/json': { schema: resolver(z.array(cardSchema)) } },
      },
    },
  }),
  async (c) => {
    const items = await db.select().from(cards)
    return c.json(items)
  }
)

// Lookup card by UID (used by ESP32)
cardRoutes.get(
  '/lookup/:uid',
  describeRoute({
    tags: ['Cards'],
    summary: 'Lookup card by UID',
    description: 'Get card details with associated content (media, playlist, or podcast)',
    responses: {
      200: {
        description: 'Card with content',
        content: { 'application/json': { schema: resolver(cardLookupResponseSchema) } },
      },
      404: {
        description: 'Card not found',
        content: { 'application/json': { schema: resolver(errorSchema.extend({ uid: z.string() })) } },
      },
    },
  }),
  sValidator('param', uidParamSchema),
  async (c) => {
    const { uid } = c.req.valid('param')

    const [card] = await db.select().from(cards).where(eq(cards.uid, uid)).limit(1)

    if (!card) {
      return c.json({ error: 'Card not found', uid }, 404)
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

    return c.json(response)
  }
)

// Get single card
cardRoutes.get(
  '/:id',
  describeRoute({
    tags: ['Cards'],
    summary: 'Get card by ID',
    responses: {
      200: {
        description: 'Card',
        content: { 'application/json': { schema: resolver(cardSchema) } },
      },
      404: {
        description: 'Card not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
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
  describeRoute({
    tags: ['Cards'],
    summary: 'Create card',
    responses: {
      201: {
        description: 'Created card',
        content: { 'application/json': { schema: resolver(cardSchema) } },
      },
    },
  }),
  sValidator('json', createCardSchema),
  async (c) => {
    const data = c.req.valid('json')

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
  describeRoute({
    tags: ['Cards'],
    summary: 'Update card',
    responses: {
      200: {
        description: 'Updated card',
        content: { 'application/json': { schema: resolver(cardSchema) } },
      },
      404: {
        description: 'Card not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', updateCardSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')

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
  describeRoute({
    tags: ['Cards'],
    summary: 'Delete card',
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
      404: {
        description: 'Card not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const [deleted] = await db.delete(cards).where(eq(cards.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Card not found' }, 404)
    }

    return c.json({ success: true })
  }
)
