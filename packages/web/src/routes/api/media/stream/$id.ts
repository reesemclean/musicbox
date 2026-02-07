import { createFileRoute } from '@tanstack/react-router'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db/index.js'
import { media } from '@/db/schema.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

export const Route = createFileRoute('/api/media/stream/$id')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const id = parseInt(params.id, 10)

        if (isNaN(id)) {
          return new Response('Invalid ID', { status: 400 })
        }

        const [item] = await db.select().from(media).where(eq(media.id, id)).limit(1)

        if (!item) {
          return new Response('Media not found', { status: 404 })
        }

        const fullPath = join(DATA_DIR, item.filePath)

        if (!existsSync(fullPath)) {
          return new Response('File not found on disk', { status: 404 })
        }

        const stat = statSync(fullPath)
        const range = request.headers.get('range')

        // Support range requests for seeking
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-')
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
          const chunkSize = end - start + 1

          const stream = createReadStream(fullPath, { start, end })
          const webStream = nodeStreamToWebStream(stream)

          return new Response(webStream, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize.toString(),
              'Content-Type': item.mimeType || 'audio/mpeg',
            },
          })
        }

        // Full file response
        const stream = createReadStream(fullPath)
        const webStream = nodeStreamToWebStream(stream)

        return new Response(webStream, {
          headers: {
            'Content-Length': stat.size.toString(),
            'Content-Type': item.mimeType || 'audio/mpeg',
            'Accept-Ranges': 'bytes',
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
