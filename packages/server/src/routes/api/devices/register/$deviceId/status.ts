/**
 * Device registration status API route
 * GET /api/devices/register/:deviceId/status
 *
 * Polled by the agent to check if the device has been approved.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../../services/devicesService.js'

export const Route = createFileRoute('/api/devices/register/$deviceId/status')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const deviceId = parseInt(params.deviceId, 10)

          if (isNaN(deviceId)) {
            return Response.json(
              { error: 'Invalid device ID' },
              { status: 400 },
            )
          }

          const result = await devicesService.getRegistrationStatus(deviceId)

          if (!result) {
            return Response.json(
              { error: 'Device not found' },
              { status: 404 },
            )
          }

          // Return different responses based on status
          if (result.status === 'approved') {
            return Response.json({
              status: result.status,
              secret: result.secret,
              name: result.name,
            })
          }

          return Response.json({
            status: result.status,
          })
        } catch (error) {
          console.error('Registration status endpoint error:', error)
          return Response.json(
            { error: 'Failed to get registration status' },
            { status: 500 },
          )
        }
      },
    },
  },
})
