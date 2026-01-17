/**
 * Player version API route
 * GET /api/player/version
 *
 * Returns the bundled player version and checksum.
 */

import { createFileRoute } from '@tanstack/react-router'
import {
  getPlayerBundleSize,
  getPlayerChecksum,
  getPlayerVersion,
  hasPlayerBundle,
} from '../../../lib/player-bundle.js'

export const Route = createFileRoute('/api/player/version')({
  server: {
    handlers: {
      GET: () => {
        if (!hasPlayerBundle()) {
          return Response.json(
            { error: 'No player bundle available' },
            { status: 404 },
          )
        }

        return Response.json({
          version: getPlayerVersion(),
          checksum: getPlayerChecksum(),
          size: getPlayerBundleSize(),
          downloadUrl: '/api/player/download',
        })
      },
    },
  },
})
