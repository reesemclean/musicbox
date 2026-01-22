/**
 * Sound Machine - Stream a sound file
 * GET /api/soundmachine/stream/$name
 *
 * Streams the audio file for the given sound name
 */

import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { getSoundFileInfo } from '@/lib/soundmachine'

export const Route = createFileRoute('/api/soundmachine/stream/$name')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { name } = params

        if (!name) {
          return new Response('Sound name is required', { status: 400 })
        }

        // Decode the URL-encoded name
        const decodedName = decodeURIComponent(name)

        const fileInfo = getSoundFileInfo(decodedName)

        if (!fileInfo) {
          return new Response('Sound not found', { status: 404 })
        }

        try {
          // Read the file
          const fileData = fs.readFileSync(fileInfo.path)
          const audioData = new Uint8Array(fileData)

          return new Response(audioData, {
            headers: {
              'Content-Type': fileInfo.mimeType,
              'Content-Length': fileInfo.size.toString(),
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
            },
          })
        } catch (error) {
          console.error('[soundmachine] Error streaming sound:', error)
          return new Response('Failed to stream sound', { status: 500 })
        }
      },
    },
  },
})
