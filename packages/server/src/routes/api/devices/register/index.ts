/**
 * Device registration API route
 * POST /api/devices/register
 *
 * Called by the agent on first boot to register a new device.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../services/devicesService.js'

export const Route = createFileRoute('/api/devices/register/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { hardwareId, hostname } = body

          if (!hardwareId) {
            return Response.json(
              { error: 'Missing required field: hardwareId' },
              { status: 400 },
            )
          }

          const result = await devicesService.registerDevice(
            hardwareId,
            hostname || 'unknown',
          )

          return Response.json({
            deviceId: result.deviceId,
            status: result.status,
          })
        } catch (error) {
          console.error('Registration endpoint error:', error)
          return Response.json(
            { error: 'Failed to register device' },
            { status: 500 },
          )
        }
      },
    },
  },
})
