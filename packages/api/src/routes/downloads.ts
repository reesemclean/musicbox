import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { searchSongs, searchAlbums } from '../services/ytmusicService.js'
import {
  queueDownload,
  getDownloadQueueStatus,
  retryDownload,
  removeFromQueue,
  downloadAlbum,
} from '../services/downloadService.js'

export const downloadRoutes = new Hono()

// Schemas
const searchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.enum(['songs', 'albums']).optional().default('songs'),
})

const searchResultSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  artists: z.array(z.string()),
  album: z.string().nullable(),
  duration: z.number().nullable(),
  thumbnails: z.array(z.object({
    url: z.string(),
    width: z.number(),
    height: z.number(),
  })).optional(),
})

const albumSearchResultSchema = z.object({
  browseId: z.string(),
  title: z.string(),
  artist: z.string(),
  year: z.number().nullable(),
  trackCount: z.number().nullable(),
  thumbnails: z.array(z.object({
    url: z.string(),
    width: z.number(),
    height: z.number(),
  })).optional(),
})

const downloadRequestSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  thumbnailUrl: z.string().optional(),
})

const queueItemSchema = z.object({
  id: z.number(),
  videoId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  album: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  status: z.enum(['pending', 'downloading', 'failed']),
  progress: z.number(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
})

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const errorSchema = z.object({
  error: z.string(),
})

const successSchema = z.object({
  success: z.boolean(),
})

// Search YouTube Music
downloadRoutes.get(
  '/search',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Search YouTube Music',
    description: 'Search for songs or albums on YouTube Music',
    parameters: [
      { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'type', in: 'query', required: false, schema: { type: 'string', enum: ['songs', 'albums'], default: 'songs' } },
    ],
    responses: {
      200: {
        description: 'Search results',
        content: { 'application/json': { schema: resolver(z.array(searchResultSchema)) } },
      },
      500: {
        description: 'Search failed',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('query', searchQuerySchema),
  async (c) => {
    const { q, type } = c.req.valid('query')

    try {
      if (type === 'albums') {
        const results = await searchAlbums(q)
        return c.json(results)
      } else {
        const results = await searchSongs(q)
        return c.json(results)
      }
    } catch (error) {
      console.error('Search failed:', error)
      return c.json(
        { error: error instanceof Error ? error.message : 'Search failed' },
        500
      )
    }
  }
)

// Queue download
downloadRoutes.post(
  '/',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Queue a download',
    description: 'Add a song to the download queue',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: resolver(downloadRequestSchema) } },
    },
    responses: {
      201: {
        description: 'Download queued',
        content: { 'application/json': { schema: resolver(z.object({ id: z.number(), videoId: z.string() })) } },
      },
      500: {
        description: 'Failed to queue download',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('json', downloadRequestSchema),
  async (c) => {
    const { videoId, title, artist, album, thumbnailUrl } = c.req.valid('json')

    try {
      const result = await queueDownload(videoId, title, artist, album, thumbnailUrl)
      return c.json(result, 201)
    } catch (error) {
      console.error('Failed to queue download:', error)
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to queue download' },
        500
      )
    }
  }
)

// Get queue status
downloadRoutes.get(
  '/queue',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Get download queue',
    description: 'Get all items in the download queue',
    responses: {
      200: {
        description: 'Download queue',
        content: { 'application/json': { schema: resolver(z.array(queueItemSchema)) } },
      },
    },
  }),
  async (c) => {
    const queue = await getDownloadQueueStatus()
    return c.json(queue)
  }
)

// Retry failed download
downloadRoutes.post(
  '/:id/retry',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Retry failed download',
    responses: {
      200: {
        description: 'Retry started',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
      404: {
        description: 'Download not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
      400: {
        description: 'Cannot retry',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    try {
      await retryDownload(id)
      return c.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      const status = message === 'Download not found' ? 404 : 400
      return c.json({ error: message }, status)
    }
  }
)

// Download album
const downloadAlbumRequestSchema = z.object({
  browseId: z.string(),
})

downloadRoutes.post(
  '/album',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Download album',
    description: 'Download all tracks from an album and create a playlist',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: resolver(downloadAlbumRequestSchema) } },
    },
    responses: {
      201: {
        description: 'Album download started',
        content: {
          'application/json': {
            schema: resolver(z.object({
              playlistId: z.number(),
              albumTitle: z.string(),
              trackCount: z.number(),
            })),
          },
        },
      },
      500: {
        description: 'Failed to start album download',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('json', downloadAlbumRequestSchema),
  async (c) => {
    const { browseId } = c.req.valid('json')

    try {
      const result = await downloadAlbum(browseId)
      return c.json(result, 201)
    } catch (error) {
      console.error('Failed to download album:', error)
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to download album' },
        500
      )
    }
  }
)

// Remove from queue
downloadRoutes.delete(
  '/:id',
  describeRoute({
    tags: ['Downloads'],
    summary: 'Remove from queue',
    responses: {
      200: {
        description: 'Removed',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    await removeFromQueue(id)
    return c.json({ success: true })
  }
)
