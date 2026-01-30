import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import {
  addPodcastFeed,
  getPodcastFeeds,
  getPodcastFeed,
  deletePodcastFeed,
  updatePodcastFeed,
  refreshFeed,
  refreshAllFeeds,
} from '../services/podcastService.js'

export const podcastRoutes = new Hono()

// Schemas
const feedSchema = z.object({
  id: z.number(),
  name: z.string(),
  feedUrl: z.string(),
  imageUrl: z.string().nullable(),
  retentionCount: z.number(),
  lastFetchedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  episodeCount: z.number().optional(),
})

const episodeSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().nullable(),
  filePath: z.string(),
  metadata: z.string().nullable(),
  createdAt: z.string().datetime(),
})

const addFeedRequestSchema = z.object({
  feedUrl: z.string().url(),
  retentionCount: z.number().min(1).max(10).optional().default(3),
})

const updateFeedRequestSchema = z.object({
  name: z.string().optional(),
  retentionCount: z.number().min(1).max(10).optional(),
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

// List all feeds
podcastRoutes.get(
  '/',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'List podcast feeds',
    description: 'Get all podcast feed subscriptions',
    responses: {
      200: {
        description: 'List of podcast feeds',
        content: { 'application/json': { schema: resolver(z.array(feedSchema)) } },
      },
    },
  }),
  async (c) => {
    const feeds = await getPodcastFeeds()
    return c.json(feeds)
  }
)

// Get single feed with episodes
podcastRoutes.get(
  '/:id',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Get podcast feed',
    description: 'Get a podcast feed with its episodes',
    responses: {
      200: {
        description: 'Podcast feed with episodes',
        content: {
          'application/json': {
            schema: resolver(feedSchema.extend({ episodes: z.array(episodeSchema) })),
          },
        },
      },
      404: {
        description: 'Feed not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    try {
      const feed = await getPodcastFeed(id)
      return c.json(feed)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Feed not found' },
        404
      )
    }
  }
)

// Add new feed
podcastRoutes.post(
  '/',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Add podcast feed',
    description: 'Subscribe to a new podcast feed',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: resolver(addFeedRequestSchema) } },
    },
    responses: {
      201: {
        description: 'Feed added',
        content: {
          'application/json': {
            schema: resolver(z.object({
              id: z.number(),
              name: z.string(),
              imageUrl: z.string().nullable(),
            })),
          },
        },
      },
      400: {
        description: 'Invalid feed or already exists',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('json', addFeedRequestSchema),
  async (c) => {
    const { feedUrl, retentionCount } = c.req.valid('json')

    try {
      const feed = await addPodcastFeed(feedUrl, retentionCount)
      return c.json(feed, 201)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to add feed' },
        400
      )
    }
  }
)

// Update feed
podcastRoutes.patch(
  '/:id',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Update podcast feed',
    description: 'Update feed name or retention count',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: resolver(updateFeedRequestSchema) } },
    },
    responses: {
      200: {
        description: 'Feed updated',
        content: { 'application/json': { schema: resolver(feedSchema) } },
      },
      404: {
        description: 'Feed not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', updateFeedRequestSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const updates = c.req.valid('json')

    try {
      const feed = await updatePodcastFeed(id, updates)
      return c.json(feed)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to update feed' },
        404
      )
    }
  }
)

// Delete feed
podcastRoutes.delete(
  '/:id',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Delete podcast feed',
    description: 'Unsubscribe from a podcast feed and delete its episodes',
    responses: {
      200: {
        description: 'Feed deleted',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    await deletePodcastFeed(id)
    return c.json({ success: true })
  }
)

// Refresh single feed
podcastRoutes.post(
  '/:id/refresh',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Refresh podcast feed',
    description: 'Fetch new episodes for a podcast feed',
    responses: {
      200: {
        description: 'Feed refreshed',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
      404: {
        description: 'Feed not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')

    try {
      await refreshFeed(id)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to refresh feed' },
        404
      )
    }
  }
)

// Refresh all feeds
podcastRoutes.post(
  '/refresh',
  describeRoute({
    tags: ['Podcasts'],
    summary: 'Refresh all feeds',
    description: 'Fetch new episodes for all podcast feeds',
    responses: {
      200: {
        description: 'Feeds refreshed',
        content: {
          'application/json': {
            schema: resolver(z.object({
              succeeded: z.number(),
              failed: z.number(),
              total: z.number(),
            })),
          },
        },
      },
    },
  }),
  async (c) => {
    const result = await refreshAllFeeds()
    return c.json(result)
  }
)
