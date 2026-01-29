import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { playlists, playlistMedia, media } from '../db/schema.js'

export const playlistRoutes = new Hono()

// Validation schemas
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
  position: z.number().optional(), // If not provided, append to end
})

const reorderSchema = z.object({
  mediaIds: z.array(z.number()), // Array of media IDs in desired order
})

// List all playlists
playlistRoutes.get('/', async (c) => {
  const items = await db.select().from(playlists)
  return c.json(items)
})

// Get single playlist with media
playlistRoutes.get(
  '/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1)

    if (!playlist) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    // Get media items in order
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
  zValidator('json', createPlaylistSchema),
  async (c) => {
    const { name } = c.req.valid('json')

    const [created] = await db.insert(playlists).values({ name }).returning()

    return c.json(created, 201)
  }
)

// Update playlist
playlistRoutes.patch(
  '/:id',
  zValidator('param', idParamSchema),
  zValidator('json', updatePlaylistSchema),
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
  zValidator('param', idParamSchema),
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
  zValidator('param', idParamSchema),
  zValidator('json', addMediaSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { mediaId, position } = c.req.valid('json')

    // Verify playlist exists
    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, id)).limit(1)
    if (!playlist) {
      return c.json({ error: 'Playlist not found' }, 404)
    }

    // Verify media exists
    const [mediaItem] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    if (!mediaItem) {
      return c.json({ error: 'Media not found' }, 404)
    }

    // Get current max position if not provided
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
  zValidator('param', z.object({
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

// Reorder playlist - pass array of media IDs in desired order
playlistRoutes.put(
  '/:id/reorder',
  zValidator('param', idParamSchema),
  zValidator('json', reorderSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { mediaIds } = c.req.valid('json')

    // Delete existing entries and re-insert with new positions
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
