import { createFileRoute } from '@tanstack/react-router'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseBuffer } from 'music-metadata'
import { db } from '@/db/index.js'
import { media } from '@/db/schema.js'
import { profileAudio } from '@/lib/mp3'
import {
  CANONICAL_MIME,
  isCanonical,
  transcodeToCanonical,
} from '@/services/audioNormalize.js'

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
        // Everything is stored as MP3 regardless of what was uploaded, so the
        // whole library stays frame-compatible for the playlist stream.
        const fileName = `${uuid}.mp3`
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

        // Keep a conforming upload byte-for-byte; re-encoding it would lose
        // quality for nothing. Anything else goes through ffmpeg.
        const uploadedProfile = profileAudio(uploadedBytes)
        const tempPath = join(songsDir, `tmp_${uuid}`)

        try {
          if (isCanonical(uploadedProfile)) {
            await fs.writeFile(filePath, uploadedBytes)
          } else {
            await fs.writeFile(tempPath, uploadedBytes)
            await transcodeToCanonical(tempPath, filePath)
          }
        } catch (err) {
          await fs.unlink(filePath).catch(() => {})
          return Response.json(
            {
              error: `Could not process audio: ${err instanceof Error ? err.message : 'unknown error'}`,
            },
            { status: 422 }
          )
        } finally {
          await fs.unlink(tempPath).catch(() => {})
        }

        // Profile what was actually stored, not what was uploaded.
        const stored = await fs.readFile(filePath)
        const profile = profileAudio(stored)

        if (profile.frameCount === 0) {
          await fs.unlink(filePath).catch(() => {})
          return Response.json(
            { error: 'No decodable audio found in file' },
            { status: 422 }
          )
        }

        const [newMedia] = await db.insert(media).values({
          type: 'song',
          title,
          duration: Math.round(profile.durationSec),
          mimeType: CANONICAL_MIME,
          fileSize: stored.length,
          audioBytes: profile.audioBytes,
          sampleRate: profile.sampleRate,
          channels: profile.channels,
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
