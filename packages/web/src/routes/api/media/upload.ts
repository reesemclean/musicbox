import { createFileRoute } from '@tanstack/react-router'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseBuffer } from 'music-metadata'
import { db } from '@/db/index.js'
import { media } from '@/db/schema.js'
import { CANONICAL_MIME, ensureNormalized } from '@/services/audioNormalize.js'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

export const Route = createFileRoute('/api/media/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData()
        const file = formData.get('file')

        if (!file || !(file instanceof File)) {
          return Response.json({ error: 'No file provided' }, { status: 400 })
        }

        // Validate mime type
        const allowedTypes = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/wav', 'audio/ogg', 'audio/webm']
        if (!allowedTypes.some((t) => file.type.startsWith(t.split('/')[0]))) {
          return Response.json({ error: 'Invalid file type' }, { status: 400 })
        }

        const songsDir = join(DATA_DIR, 'songs')
        await fs.mkdir(songsDir, { recursive: true })

        const uuid = crypto.randomUUID()
        // Keep the upload in the format it arrived in — it is the archival
        // copy. A canonical derivative is generated separately if needed.
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp3'
        const fileName = `${uuid}.${ext}`
        const relativePath = `songs/${fileName}`
        const filePath = join(songsDir, fileName)
        const uploadedBytes = Buffer.from(await file.arrayBuffer())

        // Read tags from the original — transcoding strips them deliberately.
        let artist: string | undefined
        let album: string | undefined
        let title = file.name.replace(/\.[^/.]+$/, '') // filename without extension

        try {
          const tags = await parseBuffer(uploadedBytes, { mimeType: file.type })
          if (tags.common.title) title = tags.common.title
          if (tags.common.artist) artist = tags.common.artist
          if (tags.common.album) album = tags.common.album
        } catch {
          // Metadata extraction is optional; the filename is a fine fallback.
        }

        await fs.writeFile(filePath, uploadedBytes)

        // Derive a canonical version if the upload isn't already one. The
        // original stays untouched either way.
        let result
        try {
          result = await ensureNormalized(DATA_DIR, relativePath)
        } catch (err) {
          await fs.unlink(filePath).catch(() => {})
          return Response.json(
            {
              error: `Could not process audio: ${err instanceof Error ? err.message : 'unknown error'}`,
            },
            { status: 422 }
          )
        }

        if (result.profile.frameCount === 0) {
          await fs.unlink(filePath).catch(() => {})
          return Response.json(
            { error: 'No decodable audio found in file' },
            { status: 422 }
          )
        }

        const [newMedia] = await db.insert(media).values({
          type: 'song',
          title,
          duration: Math.round(result.profile.durationSec),
          mimeType: CANONICAL_MIME,
          fileSize: uploadedBytes.length,
          audioBytes: result.profile.audioBytes,
          sampleRate: result.profile.sampleRate,
          channels: result.profile.channels,
          filePath: relativePath,
          normalizedPath: result.normalizedPath,
          metadata: {
            artist: artist || null,
            album: album || null,
          },
        }).returning()

        return Response.json(newMedia)
      },
    },
  },
})
