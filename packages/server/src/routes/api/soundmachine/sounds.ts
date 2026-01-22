/**
 * Sound Machine - List available sounds
 * GET /api/soundmachine/sounds
 */

import { createFileRoute } from '@tanstack/react-router'
import { getSoundMachineSounds } from '@/lib/soundmachine'

export const Route = createFileRoute('/api/soundmachine/sounds')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sounds = getSoundMachineSounds()
          return Response.json({ sounds })
        } catch (error) {
          console.error('[soundmachine] Error listing sounds:', error)
          return Response.json(
            { error: 'Failed to list sounds' },
            { status: 500 },
          )
        }
      },
    },
  },
})
