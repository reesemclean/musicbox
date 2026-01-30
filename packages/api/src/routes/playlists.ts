import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { playlists, playlistMedia, media } from '../db/schema.js'
import { mediaTypeSchema } from '../types/media.js'

export const playlistRoutes = new Hono()

// Schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const createPlaylistSchema = z.object({
  name: z.string().min(1),
})

const updatePlaylistSchema = z.object({
  name: z.string().min(1).optional(),
})

const addMediaSchema = z.object({
  mediaId: z.number(),
  position: z.number().optional(),
})

const reorderSchema = z.object({
  mediaIds: z.array(z.number()),
})

const playlistSchema = z.object({
  id: z.number(),
  name: z.string(),
  createdAt: z.string().datetime(),
})

const mediaSchema = z.object({
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

const playlistWithMediaSchema = playlistSchema.extend({
  items: z.array(mediaSchema.extend({ position: z.number() })),
})

const errorSchema = z.object({
  error: z.string(),
})

const successSchema = z.object({
  success: z.boolean(),
})

// List all playlists
playlistRoutes.get(
  '/',
  describeRoute({
    tags: ['Playlists'],
    summary: 'List all playlists',
    responses: {
      200: {
        description: 'List of playlists',
        content: { 'application/json': { schema: resolver(z.array(playlistSchema)) } },
      },
    },
  }),
  async (c) => {
    const items = await db.select().from(playlists)
    return c.json(items)
  }
)

// Get single playlist with media
playlistRoutes.get(
  '/:id',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Get playlist by ID',
    description: 'Get a playlist with its media items',
    responses: {
      200: {
        description: 'Playlist with media',
        content: { 'application/json': { schema: resolver(playlistWithMediaSchema) } },
      },
      404: {
        description: 'Playlist not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1)

    if (!playlist) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    const items = await db
      .select({
        position: playlistMedia.position,
        media: media,
      })
      .from(playlistMedia)
      .innerJoin(media, eq(playlistMedia.mediaId, media.id))
      .where(eq(playlistMedia.playlistId, id))
      .orderBy(asc(playlistMedia.position))

    return c.json({
      ...playlist,
      items: items.map((i) => ({ ...i.media, position: i.position })),
    })
  }
)

// Create playlist
playlistRoutes.post(
  '/',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Create playlist',
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: resolver(createPlaylistSchema) },
      },
    },
    responses: {
      201: {
        description: 'Created playlist',
        content: { 'application/json': { schema: resolver(playlistSchema) } },
      },
    },
  }),
  sValidator('json', createPlaylistSchema),
  async (c) => {
    const { name } = c.req.valid('json')
    const [created] = await db.insert(playlists).values({ name }).returning()
    return c.json(created, 201)
  }
)

// Update playlist
playlistRoutes.patch(
  '/:id',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Update playlist',
    responses: {
      200: {
        description: 'Updated playlist',
        content: { 'application/json': { schema: resolver(playlistSchema) } },
      },
      404: {
        description: 'Playlist not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', updatePlaylistSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const updates = c.req.valid('json')

    const [updated] = await db
      .update(playlists)
      .set(updates)
      .where(eq(playlists.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    return c.json(updated)
  }
)

// Delete playlist
playlistRoutes.delete(
  '/:id',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Delete playlist',
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
      404: {
        description: 'Playlist not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const [deleted] = await db.delete(playlists).where(eq(playlists.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    return c.json({ success: true })
  }
)

// Add media to playlist
playlistRoutes.post(
  '/:id/media',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Add media to playlist',
    responses: {
      201: {
        description: 'Added to playlist',
        content: { 'application/json': { schema: resolver(z.object({
          id: z.number(),
          playlistId: z.number(),
          mediaId: z.number(),
          position: z.number(),
        })) } },
      },
      404: {
        description: 'Not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', addMediaSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { mediaId, position } = c.req.valid('json')

    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1)
    if (!playlist) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    const [mediaItem] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    if (!mediaItem) {
      return c.json({ error: 'Media not found' }, 404)
    }

    let pos = position
    if (pos === undefined) {
      const existing = await db
        .select({ position: playlistMedia.position })
        .from(playlistMedia)
        .where(eq(playlistMedia.playlistId, id))
        .orderBy(asc(playlistMedia.position))

      pos = existing.length > 0 ? Math.max(...existing.map((e) => e.position)) + 1 : 0
    }

    const [added] = await db
      .insert(playlistMedia)
      .values({ playlistId: id, mediaId, position: pos })
      .returning()

    return c.json(added, 201)
  }
)

// Remove media from playlist
playlistRoutes.delete(
  '/:id/media/:mediaId',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Remove media from playlist',
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
    },
  }),
  sValidator('param', z.object({
    id: z.string().regex(/^\d+$/).transform(Number),
    mediaId: z.string().regex(/^\d+$/).transform(Number),
  })),
  async (c) => {
    const { id, mediaId } = c.req.valid('param')

    await db
      .delete(playlistMedia)
      .where(
        and(
          eq(playlistMedia.playlistId, id),
          eq(playlistMedia.mediaId, mediaId)
        )
      )

    return c.json({ success: true })
  }
)

// Reorder playlist
playlistRoutes.put(
  '/:id/reorder',
  describeRoute({
    tags: ['Playlists'],
    summary: 'Reorder playlist media',
    description: 'Pass array of media IDs in desired order',
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', reorderSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { mediaIds } = c.req.valid('json')

    await db.delete(playlistMedia).where(eq(playlistMedia.playlistId, id))

    const newEntries = mediaIds.map((mediaId, index) => ({
      playlistId: id,
      mediaId,
      position: index,
    }))

    if (newEntries.length > 0) {
      await db.insert(playlistMedia).values(newEntries)
    }

    return c.json({ success: true })
  }
)
