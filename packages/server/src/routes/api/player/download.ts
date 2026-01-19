/**
 * Player download API route
 * GET /api/player/download
 *
 * Serves the player Go binary for device updates.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import {
  getPlayerBundlePath,
  getPlayerBundleSize,
  hasPlayerBundle,
} from '../../../lib/player-bundle.js'

export const Route = createFileRoute('/api/player/download')({
  server: {
    handlers: {
      GET: () => {
        if (!hasPlayerBundle()) {
          return Response.json(
            { error: 'No player binary available' },
            { status: 404 },
          )
        }

        const binaryPath = getPlayerBundlePath()
        const binarySize = getPlayerBundleSize()

        if (!binaryPath || !binarySize) {
          return Response.json(
            { error: 'Player binary not accessible' },
            { status: 500 },
          )
        }

        const stream = createReadStream(binaryPath)
        const webStream = Readable.toWeb(stream) as ReadableStream

        return new Response(webStream, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': binarySize.toString(),
            'Content-Disposition': 'attachment; filename="musicbox-player"',
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (versioned)
          },
        })
      },
    },
  },
})
