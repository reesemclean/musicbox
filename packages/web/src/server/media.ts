import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { ownedPaths } from '../lib/media.js'

export const getMedia = createServerFn({ method: 'GET' })
  .inputValidator((data: { type?: 'song' | 'podcast' | 'soundmachine' }) => data)
  .handler(async ({ data }) => {
    const items = data.type
      ? await db.select().from(media).where(eq(media.type, data.type))
      : await db.select().from(media)
    return items
  })

export const getMediaById = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [item] = await db.select().from(media).where(eq(media.id, data.id)).limit(1)
    if (!item) throw new Error('Media not found')
    return item
  })

export const updateMedia = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; title?: string; metadata?: object }) => data)
  .handler(async ({ data }) => {
    const { id, ...updates } = data
    const [existing] = await db.select().from(media).where(eq(media.id, id)).limit(1)
    if (!existing) throw new Error('Media not found')

    const newMetadata = updates.metadata
      ? { ...(existing.metadata as object || {}), ...updates.metadata }
      : existing.metadata

    const [updated] = await db
      .update(media)
      .set({
        title: updates.title ?? existing.title,
        metadata: newMetadata,
      })
      .where(eq(media.id, id))
      .returning()

    return updated
  })

export const deleteMedia = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [item] = await db.select().from(media).where(eq(media.id, data.id)).limit(1)
    if (!item) throw new Error('Media not found')

    // Delete every file this item owns — the original and, when present, its
    // canonical derivative. Missing files are not an error: the DB row should
    // go either way rather than being left dangling.
    const { existsSync, unlinkSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data')

    for (const relative of ownedPaths(item)) {
      const fullPath = join(dataDir, relative)
      if (existsSync(fullPath)) {
        unlinkSync(fullPath)
      }
    }

    await db.delete(media).where(eq(media.id, data.id))
    return { success: true }
  })
