/**
 * Device SSH key installed notification API route
 * POST /api/devices/register/:deviceId/ssh-ready
 *
 * Called by the bootstrap script after installing the SSH public key.
 * Triggers deployment to the device.
 *
 * Requires device secret for authentication.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../../services/devicesService.js'
import * as ansibleService from '../../../../../services/ansibleService.js'

export const Route = createFileRoute(
  '/api/devices/register/$deviceId/ssh-ready',
)({
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

          // Parse body for secret
          const body = await request.json().catch(() => ({}))
          const secret = body.secret as string | undefined

          if (!secret) {
            console.warn(`[ssh-ready] Device ${deviceId} missing secret`)
            return Response.json(
              { error: 'Missing device secret' },
              { status: 401 },
            )
          }

          // Verify secret matches device
          const device = await devicesService.getDeviceById(deviceId)
          if (!device) {
            return Response.json({ error: 'Device not found' }, { status: 404 })
          }

          if (device.secret !== secret) {
            console.warn(
              `[ssh-ready] Device ${deviceId} provided invalid secret`,
            )
            return Response.json(
              { error: 'Invalid device secret' },
              { status: 401 },
            )
          }

          console.log(
            `[ssh-ready] Device ${deviceId} (${device.name}) reporting SSH key installed`,
          )

          const updatedDevice =
            await devicesService.reportSshKeyInstalled(deviceId)

          if (!updatedDevice) {
            return Response.json(
              { error: 'Failed to update device' },
              { status: 500 },
            )
          }

          // Only trigger deployment for approved devices with an IP address
          if (updatedDevice.status === 'approved' && updatedDevice.ipAddress) {
            console.log(
              `[ssh-ready] Device ${deviceId} is approved with IP ${updatedDevice.ipAddress}, triggering deployment`,
            )

            try {
              const runId = await ansibleService.runPlaybook('site', deviceId)
              console.log(
                `[ssh-ready] Triggered deployment for device ${deviceId}, run ID: ${runId}`,
              )

              return Response.json({
                success: true,
                message: 'SSH key registered, deployment triggered',
                deploymentRunId: runId,
              })
            } catch (err) {
              console.error(
                `[ssh-ready] Failed to trigger deployment for device ${deviceId}:`,
                err,
              )
              // Still return success for SSH key registration
              return Response.json({
                success: true,
                message: 'SSH key registered, but deployment failed to start',
                error: err instanceof Error ? err.message : String(err),
              })
            }
          } else {
            console.log(
              `[ssh-ready] Device ${deviceId} not ready for deployment (status=${updatedDevice.status}, ip=${updatedDevice.ipAddress})`,
            )
            return Response.json({
              success: true,
              message: 'SSH key registered, awaiting approval or IP address',
            })
          }
        } catch (error) {
          console.error('[ssh-ready] Endpoint error:', error)
          return Response.json(
            { error: 'Failed to process SSH ready notification' },
            { status: 500 },
          )
        }
      },
    },
  },
})
