import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from 'zod'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'

// System sounds directory (relative to data dir)
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')
const SOUNDS_DIR = join(DATA_DIR, 'sounds')

// Allowed sound files (whitelist for security)
const ALLOWED_SOUNDS = ['startup.mp3', 'scan.mp3', 'error.mp3']

const errorSchema = z.object({
  error: z.string(),
})

export const soundsRoutes = new Hono()

// Serve system sound file
soundsRoutes.get(
  '/:filename',
  describeRoute({
    tags: ['Sounds'],
    summary: 'Get system sound',
    description: 'Stream a system sound file (startup.mp3, scan.mp3, error.mp3)',
    responses: {
      200: { description: 'Sound file' },
      404: {
        description: 'Sound not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  async (c) => {
    const filename = c.req.param('filename')

    // Security: only allow whitelisted filenames
    if (!ALLOWED_SOUNDS.includes(filename)) {
      return c.json({ error: 'Sound not found' }, 404)
    }

    const fullPath = join(SOUNDS_DIR, filename)

    if (!existsSync(fullPath)) {
      return c.json({ error: 'Sound file not found on disk' }, 404)
    }

    const stat = statSync(fullPath)
    const stream = createReadStream(fullPath)

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        'Content-Length': stat.size.toString(),
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400', // Cache for 24h
      },
    })
  }
)
