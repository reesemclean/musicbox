/**
 * Player download API route
 * GET /api/player/download
 *
 * Serves the bundled player tarball for device updates.
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
            { error: 'No player bundle available' },
            { status: 404 },
          )
        }

        const bundlePath = getPlayerBundlePath()
        const bundleSize = getPlayerBundleSize()

        if (!bundlePath || !bundleSize) {
          return Response.json(
            { error: 'Player bundle not accessible' },
            { status: 500 },
          )
        }

        const stream = createReadStream(bundlePath)
        const webStream = Readable.toWeb(stream) as ReadableStream

        return new Response(webStream, {
          headers: {
            'Content-Type': 'application/gzip',
            'Content-Length': bundleSize.toString(),
            'Content-Disposition': 'attachment; filename="player.tar.gz"',
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (versioned)
          },
        })
      },
    },
  },
})
