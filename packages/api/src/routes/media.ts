import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseBuffer } from 'music-metadata'
import { db } from '../db/index.js'
import { media } from '../db/schema.js'
import { mediaTypeSchema } from '../types/media.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '../../data')
const SONGS_DIR = join(DATA_DIR, 'songs')

// Ensure directories exist
mkdirSync(SONGS_DIR, { recursive: true })

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
    parameters: [
      {
        name: 'type',
        in: 'query',
        required: false,
        schema: { type: 'string', enum: ['song', 'podcast', 'soundmachine'] },
        description: 'Filter by media type',
      },
    ],
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

// Allowed MIME types for upload
const ALLOWED_MIME_TYPES = [
  'audio/mpeg',      // MP3
  'audio/mp4',       // M4A
  'audio/x-m4a',     // M4A alternate
  'audio/flac',      // FLAC
  'audio/wav',       // WAV
  'audio/x-wav',     // WAV alternate
  'audio/ogg',       // OGG
  'audio/vorbis',    // OGG Vorbis
]

// Upload new media (song)
mediaRoutes.post(
  '/',
  describeRoute({
    tags: ['Media'],
    summary: 'Upload media file',
    description: 'Upload an audio file (MP3, M4A, FLAC, WAV, OGG). Metadata is extracted automatically.',
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary', description: 'Audio file' },
              title: { type: 'string', description: 'Optional title override' },
            },
            required: ['file'],
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Uploaded media item',
        content: { 'application/json': { schema: resolver(mediaSchema) } },
      },
      400: {
        description: 'Invalid file or request',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const body = await c.req.parseBody()
    const file = body['file']

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400)
    }

    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return c.json({ error: `Invalid file type: ${file.type}. Allowed: MP3, M4A, FLAC, WAV, OGG` }, 400)
    }

    // Generate unique filename
    const ext = extname(file.name) || '.mp3'
    const uuid = randomUUID()
    const filename = `${uuid}${ext}`
    const filePath = join(SONGS_DIR, filename)

    try {
      // Read file buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Extract metadata
      const metadata = await parseBuffer(buffer, { mimeType: file.type })
      const common = metadata.common

      // Determine title (from form, metadata, or filename)
      const titleOverride = body['title']
      const title = (typeof titleOverride === 'string' && titleOverride.trim())
        ? titleOverride.trim()
        : common.title || file.name.replace(/\.[^/.]+$/, '')

      // Save file to disk
      writeFileSync(filePath, buffer)

      // Insert into database
      const [created] = await db.insert(media).values({
        type: 'song',
        title,
        duration: metadata.format.duration ? Math.round(metadata.format.duration) : null,
        mimeType: file.type,
        fileSize: buffer.length,
        filePath,
        metadata: {
          artist: common.artist || null,
          album: common.album || null,
          year: common.year || null,
          genre: common.genre?.[0] || null,
          track: common.track?.no || null,
        },
      }).returning()

      return c.json(created, 201)
    } catch (err) {
      // Cleanup file if it was written
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
      console.error('Upload error:', err)
      return c.json({ error: 'Failed to process file' }, 400)
    }
  }
)
