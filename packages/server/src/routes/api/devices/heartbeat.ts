/**
 * Device heartbeat API route
 * POST /api/devices/heartbeat
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../services/devicesService.js'

export const Route = createFileRoute('/api/devices/heartbeat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { secret, ipAddress, currentSong, playerVersion } = body

          if (!secret || !ipAddress) {
            return Response.json(
              {
                error: 'Missing required fields: secret and ipAddress',
              },
              { status: 400 },
            )
          }

          await devicesService.updateDeviceHeartbeat(
            secret,
            ipAddress,
            currentSong,
            playerVersion,
          )

          return Response.json({ success: true })
        } catch (error) {
          console.error('Heartbeat endpoint error:', error)
          return Response.json(
            { error: 'Failed to process heartbeat' },
            { status: 500 },
          )
        }
      },
    },
  },
})
