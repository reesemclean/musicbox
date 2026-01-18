/**
 * Device SSH key installed notification API route
 * POST /api/devices/register/:deviceId/ssh-ready
 *
 * Called by the bootstrap script after installing the SSH public key.
 * Triggers deployment to the device.
 */

import { createFileRoute } from '@tanstack/react-router'
import * as devicesService from '../../../../../services/devicesService.js'
import * as ansibleService from '../../../../../services/ansibleService.js'

export const Route = createFileRoute(
  '/api/devices/register/$deviceId/ssh-ready',
)({
  server: {
    handlers: {
      POST: async ({ params }) => {
        try {
          const deviceId = parseInt(params.deviceId, 10)

          if (isNaN(deviceId)) {
            return Response.json(
              { error: 'Invalid device ID' },
              { status: 400 },
            )
          }

          console.log(
            `[ssh-ready] Device ${deviceId} reporting SSH key installed`,
          )

          const device = await devicesService.reportSshKeyInstalled(deviceId)

          if (!device) {
            return Response.json({ error: 'Device not found' }, { status: 404 })
          }

          // Only trigger deployment for approved devices with an IP address
          if (device.status === 'approved' && device.ipAddress) {
            console.log(
              `[ssh-ready] Device ${deviceId} is approved with IP ${device.ipAddress}, triggering deployment`,
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
              `[ssh-ready] Device ${deviceId} not ready for deployment (status=${device.status}, ip=${device.ipAddress})`,
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
