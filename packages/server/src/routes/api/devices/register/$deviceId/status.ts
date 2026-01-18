/**
 * Device registration status API route
 * GET /api/devices/register/:deviceId/status
 *
 * Polled by the bootstrap script to check if the device has been approved.
 * On approval, includes the SSH public key for Ansible deployment.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../../services/devicesService.js'
import { getServerSSHPublicKey } from '../../../../../services/ansibleService.js'

export const Route = createFileRoute('/api/devices/register/$deviceId/status')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const deviceId = parseInt(params.deviceId, 10)

          if (isNaN(deviceId)) {
            return Response.json(
              { error: 'Invalid device ID' },
              { status: 400 },
            )
          }

          // Parse body for IP address
          const body = await request.json().catch(() => ({}))
          const ipAddress = body.ipAddress as string | undefined

          const result = await devicesService.getRegistrationStatus(
            deviceId,
            ipAddress,
          )

          if (!result) {
            return Response.json({ error: 'Device not found' }, { status: 404 })
          }

          // Return different responses based on status
          if (result.status === 'approved') {
            // Include SSH public key for bootstrap script to add to authorized_keys
            const sshPublicKey = getServerSSHPublicKey()
            
            console.log(`[device-status] Device ${deviceId} approved, returning SSH key (${sshPublicKey.substring(0, 50)}...)`)

            return Response.json({
              status: result.status,
              secret: result.secret,
              name: result.name,
              sshPublicKey,
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
