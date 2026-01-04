import { createFileRoute } from '@tanstack/react-router'
import { nfcQueue } from '@/lib/nfc-queue'

export const Route = createFileRoute('/api/nfc/scan')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { deviceId, nfcId } = body

          if (!deviceId || !nfcId) {
            return new Response(
              JSON.stringify({
                error: 'Missing required fields: deviceId and nfcId',
              }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }

          // Add scan to queue
          console.log(`📡 NFC scan received: ${nfcId} from ${deviceId}`)
          nfcQueue.addScan(deviceId, nfcId)

          return new Response(
            JSON.stringify({
              success: true,
              message: `NFC card ${nfcId} detected on device ${deviceId}`,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        } catch (error) {
          console.error('NFC scan endpoint error:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to process NFC scan' }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      },
    },
  },
})
