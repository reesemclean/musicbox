import { createFileRoute } from '@tanstack/react-router'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseBuffer } from 'music-metadata'
import { db } from '@/db/index.js'
import { media } from '@/db/schema.js'

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

        // Generate unique filename, keep original extension
        const uuid = crypto.randomUUID()
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'mp3'
        const fileName = `${uuid}.${ext}`
        const filePath = join(songsDir, fileName)

        // Write file to disk
        const buffer = Buffer.from(await file.arrayBuffer())
        await fs.writeFile(filePath, buffer)

        // Extract metadata
        let duration: number | undefined
        let artist: string | undefined
        let album: string | undefined
        let title = file.name.replace(/\.[^/.]+$/, '') // filename without extension

        try {
          const metadata = await parseBuffer(buffer, { mimeType: file.type })
          duration = metadata.format.duration ? Math.round(metadata.format.duration) : undefined
          if (metadata.common.title) title = metadata.common.title
          if (metadata.common.artist) artist = metadata.common.artist
          if (metadata.common.album) album = metadata.common.album
        } catch {
          // Metadata extraction is optional
        }

        // Create media entry
        const [newMedia] = await db.insert(media).values({
          type: 'song',
          title,
          duration,
          mimeType: file.type || 'audio/mpeg',
          fileSize: buffer.length,
          filePath: `songs/${fileName}`,
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
