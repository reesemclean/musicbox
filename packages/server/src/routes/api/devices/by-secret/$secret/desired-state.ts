/**
 * Device desired state API route
 * GET /api/devices/by-secret/:secret/desired-state
 *
 * Returns the desired configuration for a device to apply.
 * Player version is bundled with the server - no database lookup needed.
 */

import { createFileRoute } from '@tanstack/react-router'
import { getPlayerChecksum, getPlayerVersion } from '../../../../../lib/player-bundle.js'
import * as devicesService from '../../../../../services/devicesService.js'

export const Route = createFileRoute(
  '/api/devices/by-secret/$secret/desired-state',
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const { secret } = params

          // Verify device exists and is approved
          const device = await devicesService.getDeviceBySecret(secret)

          if (!device) {
            return Response.json({ error: 'Device not found' }, { status: 404 })
          }

          if (device.status !== 'approved') {
            return Response.json(
              { error: 'Device not approved' },
              { status: 403 },
            )
          }

          // Get bundled player info
          const playerVersion = getPlayerVersion()
          const playerChecksum = getPlayerChecksum()

          // Build desired state response
          const desiredState = {
            player: playerVersion
              ? {
                  version: playerVersion,
                  url: '/api/player/download',
                  checksum: playerChecksum,
                }
              : null,
          }

          return Response.json(desiredState)
        } catch (error) {
          console.error('Desired state endpoint error:', error)
          return Response.json(
            { error: 'Failed to get desired state' },
            { status: 500 },
          )
        }
      },
    },
  },
})
