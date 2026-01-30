import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { describeRoute, resolver } from 'hono-openapi'
import { z } from 'zod'
import { mediaRoutes } from './routes/media.js'
import { playlistRoutes } from './routes/playlists.js'
import { cardRoutes } from './routes/cards.js'
import { firmwareRoutes } from './routes/firmware.js'

const healthSchema = z.object({
  status: z.string(),
})

export function createApp() {
  const app = new Hono()

  app.use('*', logger())
  app.use('*', cors())

  app.get(
    '/health',
    describeRoute({
      tags: ['System'],
      summary: 'Health check',
      description: 'Check if the API is running',
      responses: {
        200: {
          description: 'API is healthy',
          content: { 'application/json': { schema: resolver(healthSchema) } },
        },
      },
    }),
    (c) => {
      return c.json({ status: 'ok' })
    }
  )

  app.route('/api/media', mediaRoutes)
  app.route('/api/playlists', playlistRoutes)
  app.route('/api/cards', cardRoutes)
  app.route('/api/firmware', firmwareRoutes)

  return app
}
