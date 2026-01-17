/**
 * Device config download API route
 * GET /api/devices/{deviceId}/config
 */

import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '../../../../db/index.js'
import { devices } from '../../../../db/schema.js'

export const Route = createFileRoute('/api/devices/$deviceId/config')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const deviceId = parseInt(params.deviceId, 10)

        if (isNaN(deviceId)) {
          return new Response('Invalid device ID', { status: 400 })
        }

        const device = await db.query.devices.findFirst({
          where: eq(devices.id, deviceId),
        })

        if (!device) {
          return new Response('Device not found', { status: 404 })
        }

        const config = {
          deviceId: device.id,
          deviceName: device.name,
          deviceSecret: device.secret,
          serverUrl: process.env.PUBLIC_SERVER_URL || 'http://localhost:3000',
          httpPort: device.httpPort || 8080,
        }

        const configJson = JSON.stringify(config, null, 2)

        return new Response(configJson, {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${device.name}.config.json"`,
          },
        })
      },
    },
  },
})
