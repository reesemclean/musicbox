import { createFileRoute } from '@tanstack/react-router'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { ensureInitialized } from '../../../services/startup.js'

// System sounds directory
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')
const SOUNDS_DIR = join(DATA_DIR, 'sounds')

// Allowed sound files (whitelist for security)
const ALLOWED_SOUNDS = ['startup.mp3', 'scan.mp3', 'error.mp3']

export const Route = createFileRoute('/api/sounds/$filename')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Ensure sounds are seeded before serving
        await ensureInitialized()

        const { filename } = params

        if (!filename) {
          return Response.json({ error: 'Filename is required' }, { status: 400 })
        }

        // Security: only allow whitelisted filenames
        if (!ALLOWED_SOUNDS.includes(filename)) {
          return Response.json({ error: 'Sound not found' }, { status: 404 })
        }

        const fullPath = join(SOUNDS_DIR, filename)

        if (!existsSync(fullPath)) {
          return Response.json({ error: 'Sound file not found on disk' }, { status: 404 })
        }

        const stat = statSync(fullPath)
        const stream = createReadStream(fullPath)
        const webStream = nodeStreamToWebStream(stream)

        return new Response(webStream, {
          headers: {
            'Content-Length': stat.size.toString(),
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=86400', // Cache for 24h
          },
        })
      },
    },
  },
})

function nodeStreamToWebStream(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => {
        controller.enqueue(chunk)
      })
      nodeStream.on('end', () => {
        controller.close()
      })
      nodeStream.on('error', (err) => {
        controller.error(err)
      })
    },
    cancel() {
      if ('destroy' in nodeStream && typeof nodeStream.destroy === 'function') {
        nodeStream.destroy()
      }
    },
  })
}
