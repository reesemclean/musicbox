import { createServerFn } from '@tanstack/react-start'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { playlists, playlistMedia, media, cards, type Playlist, type Media } from '../db/schema.js'
import { mqttService } from '../services/mqttService.js'

export type PlaylistWithItems = Playlist & {
  items: (Media & { position: number })[]
}

// Helper to push cache updates for all cards linked to a playlist
async function pushCardsForPlaylist(playlistId: number): Promise<void> {
  const linkedCards = await db
    .select({ uid: cards.uid })
    .from(cards)
    .where(eq(cards.playlistId, playlistId))

  for (const card of linkedCards) {
    mqttService.pushCardUpdate(card.uid)
  }
}

export const getPlaylists = createServerFn({ method: 'GET' })
  .handler(async () => {
    return db.select().from(playlists)
  })

export const getPlaylistById = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, data.id)).limit(1)
    if (!playlist) throw new Error('Playlist not found')

    const items = await db
      .select({
        position: playlistMedia.position,
        media: media,
      })
      .from(playlistMedia)
      .innerJoin(media, eq(playlistMedia.mediaId, media.id))
      .where(eq(playlistMedia.playlistId, data.id))
      .orderBy(asc(playlistMedia.position))

    return {
      ...playlist,
      items: items.map((i) => ({ ...i.media, position: i.position })),
    }
  })

export const createPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { name: string }) => data)
  .handler(async ({ data }) => {
    const [created] = await db.insert(playlists).values({ name: data.name }).returning()
    return created
  })

export const updatePlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; name?: string }) => data)
  .handler(async ({ data }) => {
    const { id, ...updates } = data
    const [updated] = await db
      .update(playlists)
      .set(updates)
      .where(eq(playlists.id, id))
      .returning()

    if (!updated) throw new Error('Playlist not found')
    return updated
  })

export const deletePlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [deleted] = await db.delete(playlists).where(eq(playlists.id, data.id)).returning()
    if (!deleted) throw new Error('Playlist not found')
    return { success: true }
  })

export const addMediaToPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistId: number; mediaId: number; position?: number }) => data)
  .handler(async ({ data }) => {
    const { playlistId, mediaId, position } = data

    // Check playlist and media exist
    const [playlist] = await db.select().from(playlists).where(eq(playlists.id, playlistId)).limit(1)
    if (!playlist) throw new Error('Playlist not found')

    const [mediaItem] = await db.select().from(media).where(eq(media.id, mediaId)).limit(1)
    if (!mediaItem) throw new Error('Media not found')

    // Calculate position
    let pos = position
    if (pos === undefined) {
      const existing = await db
        .select({ position: playlistMedia.position })
        .from(playlistMedia)
        .where(eq(playlistMedia.playlistId, playlistId))
        .orderBy(asc(playlistMedia.position))

      pos = existing.length > 0 ? Math.max(...existing.map((e) => e.position)) + 1 : 0
    }

    const [added] = await db
      .insert(playlistMedia)
      .values({ playlistId, mediaId, position: pos })
      .returning()

    // Push cache updates to devices
    pushCardsForPlaylist(playlistId)

    return added
  })

export const removeMediaFromPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistId: number; mediaId: number }) => data)
  .handler(async ({ data }) => {
    await db
      .delete(playlistMedia)
      .where(
        and(
          eq(playlistMedia.playlistId, data.playlistId),
          eq(playlistMedia.mediaId, data.mediaId)
        )
      )

    // Push cache updates to devices
    pushCardsForPlaylist(data.playlistId)

    return { success: true }
  })

export const reorderPlaylist = createServerFn({ method: 'POST' })
  .inputValidator((data: { playlistId: number; mediaIds: number[] }) => data)
  .handler(async ({ data }) => {
    const { playlistId, mediaIds } = data

    // Delete existing entries and re-insert in new order
    await db.delete(playlistMedia).where(eq(playlistMedia.playlistId, playlistId))

    const newEntries = mediaIds.map((mediaId, index) => ({
      playlistId,
      mediaId,
      position: index,
    }))

    if (newEntries.length > 0) {
      await db.insert(playlistMedia).values(newEntries)
    }

    // Push cache updates to devices
    pushCardsForPlaylist(playlistId)

    return { success: true }
  })
