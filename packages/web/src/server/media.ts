import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'

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

    // Delete file from disk
    const { existsSync, unlinkSync } = await import('node:fs')
    const { join } = await import('node:path')
    const fullPath = join(process.cwd(), 'data', item.filePath)
    if (existsSync(fullPath)) {
      unlinkSync(fullPath)
    }

    await db.delete(media).where(eq(media.id, data.id))
    return { success: true }
  })
