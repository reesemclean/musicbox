import { createFileRoute } from '@tanstack/react-router'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '@/db/index.js'
import { media } from '@/db/schema.js'
import { parseRange } from '@/lib/httpRange'
import { playablePath } from '@/lib/media'

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

        // An empty filePath means the row exists but its audio was never
        // fetched (e.g. a podcast episode still downloading). Without this
        // check, join(DATA_DIR, '') resolves to DATA_DIR itself — a directory
        // that passes existsSync/statSync, sends headers with the directory's
        // size, then throws EISDIR mid-response, leaving the client with a
        // truncated stream that never terminates cleanly.
        if (!item.filePath) {
          return new Response('Media file not yet available', { status: 404 })
        }

        // Serve the canonical derivative when one exists — that's what devices
        // expect, and its size matches the stored audioBytes.
        const fullPath = join(DATA_DIR, playablePath(item))

        if (!existsSync(fullPath)) {
          return new Response('File not found on disk', { status: 404 })
        }

        const stat = statSync(fullPath)
        if (!stat.isFile()) {
          return new Response('Media path is not a file', { status: 404 })
        }

        const contentType = item.mimeType || 'audio/mpeg'
        const range = request.headers.get('range')

        // Support range requests for seeking
        if (range) {
          const parsed = parseRange(range, stat.size)

          if (!parsed) {
            return new Response('Invalid range', {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` },
            })
          }

          const { start, end } = parsed
          const stream = createReadStream(fullPath, { start, end })

          return new Response(nodeStreamToWebStream(stream), {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': (end - start + 1).toString(),
              'Content-Type': contentType,
            },
          })
        }

        // Full file response
        const stream = createReadStream(fullPath)

        return new Response(nodeStreamToWebStream(stream), {
          headers: {
            'Content-Length': stat.size.toString(),
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          },
        })
      },
    },
  },
})

/**
 * Bridge a Node read stream to a web ReadableStream.
 *
 * Readable.toWeb propagates backpressure: it only pulls from the file when the
 * consumer is ready, so a slow client (an ESP32 on weak WiFi) throttles the
 * disk read rather than causing the whole file to be buffered in server memory.
 * It also handles stream teardown and error propagation, which is easy to get
 * subtly wrong by hand.
 */
function nodeStreamToWebStream(nodeStream: Readable): ReadableStream {
  return Readable.toWeb(nodeStream) as ReadableStream
}
