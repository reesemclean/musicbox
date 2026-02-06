import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/device/config')({
  server: {
    handlers: {
      GET: async () => {
        const host = process.env.DEVICE_MQTT_HOST || 'localhost'
        const port = parseInt(process.env.DEVICE_MQTT_PORT || '1883', 10)

        return Response.json({
          mqtt: {
            host,
            port,
          },
        })
      },
    },
  },
})
