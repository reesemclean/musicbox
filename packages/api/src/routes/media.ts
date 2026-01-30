import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { mediaTypeSchema } from '../types/media.js'

export const mediaRoutes = new Hono()

// Schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const listQuerySchema = z.object({
  type: mediaTypeSchema.optional(),
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

const errorSchema = z.object({
  error: z.string(),
})

// Stream media file
mediaRoutes.get(
  '/stream/:id',
  describeRoute({
    tags: ['Media'],
    summary: 'Stream media file',
    description: 'Stream audio/video file with range request support',
    responses: {
      200: { description: 'Media stream' },
      206: { description: 'Partial content (range request)' },
      404: {
        description: 'Media not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
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
  describeRoute({
    tags: ['Media'],
    summary: 'List all media',
    description: 'Get all media items, optionally filtered by type',
    responses: {
      200: {
        description: 'List of media items',
        content: { 'application/json': { schema: resolver(z.array(mediaSchema)) } },
      },
    },
  }),
  sValidator('query', listQuerySchema),
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
  describeRoute({
    tags: ['Media'],
    summary: 'Get media by ID',
    description: 'Get a single media item by its ID',
    responses: {
      200: {
        description: 'Media item',
        content: { 'application/json': { schema: resolver(mediaSchema) } },
      },
      404: {
        description: 'Media not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1)

    if (!item) {
      return c.json({ error: 'Media not found' }, 404)
    }

    return c.json(item)
  }
)
