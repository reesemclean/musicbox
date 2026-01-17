/**
 * Device state reporting API route
 * POST /api/devices/by-secret/:secret/state
 *
 * Called by the agent to report current device state.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../../services/devicesService.js'

export const Route = createFileRoute('/api/devices/by-secret/$secret/state')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const { secret } = params

          // Verify device exists
          const device = await devicesService.getDeviceBySecret(secret)

          if (!device) {
            return Response.json({ error: 'Device not found' }, { status: 404 })
          }

          const body = await request.json()
          const { configVersion, playerVersion, agentVersion, ip, hostname, uptime, lastError } = body

          await devicesService.updateDeviceState(secret, {
            configVersion,
            playerVersion,
            agentVersion,
            ip,
            hostname,
            uptime,
            lastError,
          })

          return Response.json({ success: true })
        } catch (error) {
          console.error('State reporting endpoint error:', error)
          return Response.json(
            { error: 'Failed to report state' },
            { status: 500 },
          )
        }
      },
    },
  },
})
