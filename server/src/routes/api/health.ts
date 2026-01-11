/**
 * Health check API route
 * GET /api/health
 */

import { createFileRoute } from '@tanstack/react-router'
import { db } from '../../db/index.js'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          // Simple database health check
          db.query.devices.findFirst()

          return Response.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          return Response.json(
            {
              status: 'unhealthy',
              error: error instanceof Error ? error.message : 'Unknown error',
              timestamp: new Date().toISOString(),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
