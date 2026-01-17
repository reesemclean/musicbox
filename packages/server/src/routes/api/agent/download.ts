/**
 * Agent download API route
 * GET /api/agent/download
 *
 * Serves the bundled agent tarball for device self-updates.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import {
  getAgentBundlePath,
  getAgentBundleSize,
  hasAgentBundle,
} from '../../../lib/agent-bundle.js'

export const Route = createFileRoute('/api/agent/download')({
  server: {
    handlers: {
      GET: () => {
        if (!hasAgentBundle()) {
          return Response.json(
            { error: 'No agent bundle available' },
            { status: 404 },
          )
        }

        const bundlePath = getAgentBundlePath()
        const bundleSize = getAgentBundleSize()

        if (!bundlePath || !bundleSize) {
          return Response.json(
            { error: 'Agent bundle not accessible' },
            { status: 500 },
          )
        }

        const stream = createReadStream(bundlePath)
        const webStream = Readable.toWeb(stream) as ReadableStream

        return new Response(webStream, {
          headers: {
            'Content-Type': 'application/gzip',
            'Content-Length': bundleSize.toString(),
            'Content-Disposition': 'attachment; filename="agent.tar.gz"',
            'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (versioned)
          },
        })
      },
    },
  },
})
