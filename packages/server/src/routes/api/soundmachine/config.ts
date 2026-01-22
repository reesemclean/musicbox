/**
 * Sound Machine - Get device's sound machine config
 * GET /api/soundmachine/config
 *
 * Requires device authentication via secret header
 * Returns the configured sound for the device, or falls back to default
 */

import { createFileRoute } from '@tanstack/react-router'
import {
  getDefaultSound,
  getSoundMachineSounds,
  soundExists,
} from '@/lib/soundmachine'
import * as devicesService from '@/services/devicesService'

export const Route = createFileRoute('/api/soundmachine/config')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          // Get device secret from header or query param
          const secret =
            request.headers.get('X-Device-Secret') ||
            new URL(request.url).searchParams.get('secret')

          if (!secret) {
            return Response.json(
              { error: 'Missing device secret' },
              { status: 401 },
            )
          }

          // Authenticate device
          const device = await devicesService.getDeviceBySecret(secret)
          if (!device) {
            return Response.json(
              { error: 'Invalid device secret' },
              { status: 401 },
            )
          }

          // Get available sounds
          const sounds = getSoundMachineSounds()
          if (sounds.length === 0) {
            return Response.json(
              { error: 'No sound machine sounds available' },
              { status: 404 },
            )
          }

          // Determine which sound to use
          let soundName = device.soundMachineSoundName

          // If configured sound doesn't exist, fall back to default
          if (!soundName || !soundExists(soundName)) {
            const defaultSound = getDefaultSound()
            soundName = defaultSound?.name || null
          }

          if (!soundName) {
            return Response.json(
              { error: 'No sound machine sounds available' },
              { status: 404 },
            )
          }

          // Build the stream URL
          const baseUrl = new URL(request.url).origin
          const streamUrl = `${baseUrl}/api/soundmachine/stream/${encodeURIComponent(soundName)}`

          return Response.json({
            soundName,
            streamUrl,
          })
        } catch (error) {
          console.error('[soundmachine] Error getting config:', error)
          return Response.json(
            { error: 'Failed to get sound machine config' },
            { status: 500 },
          )
        }
      },
    },
  },
})
