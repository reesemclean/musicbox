import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { mediaTypeSchema } from '../types/media.js'

export const mediaRoutes = new Hono()

// Validation schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const listQuerySchema = z.object({
  type: mediaTypeSchema.optional(),
})

// Stream media file
mediaRoutes.get(
  '/stream/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1)

    if (!item) {
      return c.json({ error: 'Media not found' }, 404)
    }

    if (!existsSync(item.filePath)) {
      return c.json({ error: 'File not found on disk' }, 404)
    }

    const stat = statSync(item.filePath)
    const range = c.req.header('range')

    // Support range requests for seeking
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
      const chunkSize = end - start + 1

      const stream = createReadStream(item.filePath, { start, end })

      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': item.mimeType || 'audio/mpeg',
        },
      })
    }

    // Full file response
    const stream = createReadStream(item.filePath)

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Length': stat.size.toString(),
        'Content-Type': item.mimeType || 'audio/mpeg',
        'Accept-Ranges': 'bytes',
      },
    })
  }
)

// List all media (optionally filter by type)
mediaRoutes.get(
  '/',
  zValidator('query', listQuerySchema),
  async (c) => {
    const { type } = c.req.valid('query')

    const items = type
      ? await db.select().from(media).where(eq(media.type, type))
      : await db.select().from(media)

    return c.json(items)
  }
)

// Get single media item
mediaRoutes.get(
  '/:id',
  zValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1)

    if (!item) {
      return c.json({ error: 'Media not found' }, 404)
    }

    return c.json(item)
  }
)
