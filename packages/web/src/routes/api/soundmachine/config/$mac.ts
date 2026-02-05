import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db/index.js'
import { devices, media } from '@/db/schema.js'

export const Route = createFileRoute('/api/soundmachine/config/$mac')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const { mac } = params

        if (!mac) {
          return Response.json({ error: 'MAC address is required' }, { status: 400 })
        }

        // Convert MAC without colons to with colons for DB lookup
        const macWithColons = mac.includes(':') ? mac : mac.match(/.{2}/g)?.join(':') || mac

        const [device] = await db
          .select()
          .from(devices)
          .where(eq(devices.mac, macWithColons))
          .limit(1)

        if (!device) {
          return Response.json({ error: 'Device not found' }, { status: 404 })
        }

        // If no sound configured, return nulls
        if (!device.soundMachineSound) {
          return Response.json({
            soundId: null,
            soundName: null,
            streamUrl: null,
          })
        }

        // soundMachineSound stores the media ID as string
        const soundId = parseInt(device.soundMachineSound, 10)
        if (isNaN(soundId)) {
          return Response.json({
            soundId: null,
            soundName: null,
            streamUrl: null,
          })
        }

        // Look up the sound
        const [sound] = await db
          .select()
          .from(media)
          .where(eq(media.id, soundId))
          .limit(1)

        if (!sound) {
          return Response.json({
            soundId: null,
            soundName: null,
            streamUrl: null,
          })
        }

        // Get base URL from request or environment
        const url = new URL(request.url)
        const baseUrl = process.env.API_BASE_URL || `${url.protocol}//${url.host}`

        return Response.json({
          soundId: sound.id,
          soundName: sound.title,
          streamUrl: `${baseUrl}/api/media/stream/${sound.id}`,
        })
      },
    },
  },
})
