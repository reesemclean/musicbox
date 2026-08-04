import { createFileRoute } from '@tanstack/react-router'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/db/index.js'
import { media, playlistMedia } from '@/db/schema.js'
import { extractAudioFrames } from '@/lib/mp3'
import { playablePath } from '@/lib/media'
import { ICY_METAINT } from '@/lib/icy'
import {
  findIncompatibleTrack,
  planPlaylistStream,
  type PlannedTrack,
  type StreamPlan,
} from '@/lib/playlistStream'

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data')

/**
 * Serve a whole playlist as one continuous audio response.
 *
 * The device opens this once and plays to the end, so crossing a track
 * boundary costs no reconnect and produces no gap. Which track is playing is
 * signalled in-band via ICY metadata (see lib/icy.ts), which the device's
 * decoder already requests on every connection.
 */
export const Route = createFileRoute('/api/playlists/stream/$id')({
  server: {
    handlers: {
      GET: (ctx) => handlePlaylistStream(ctx, true),
      // Registered explicitly: a HEAD request is not routed to the GET handler,
      // so without this it falls through to the SPA and answers with HTML.
      // Lets a client learn the length without transferring the whole body.
      HEAD: (ctx) => handlePlaylistStream(ctx, false),
    },
  },
})

interface HandlerContext {
  params: { id: string }
  request: Request
}

async function handlePlaylistStream(
  { params, request }: HandlerContext,
  withBody: boolean
): Promise<Response> {
  const playlistId = parseInt(params.id, 10)
  if (isNaN(playlistId)) {
    return new Response('Invalid playlist ID', { status: 400 })
  }

  // ?from=<index> starts the stream partway in, which is how a skip is served:
  // the same playlist, beginning at a different track. Index into the ordered
  // tracks rather than the position column, which may have gaps.
  const fromParam = new URL(request.url).searchParams.get('from')
  const from = fromParam === null ? 0 : parseInt(fromParam, 10)
  if (isNaN(from) || from < 0) {
    return new Response('Invalid from index', { status: 400 })
  }

  const rows = await db
    .select({
      mediaId: media.id,
      title: media.title,
      audioBytes: media.audioBytes,
      sampleRate: media.sampleRate,
      channels: media.channels,
      filePath: media.filePath,
      normalizedPath: media.normalizedPath,
    })
    .from(playlistMedia)
    .innerJoin(media, eq(playlistMedia.mediaId, media.id))
    .where(eq(playlistMedia.playlistId, playlistId))
    .orderBy(asc(playlistMedia.position))

  if (rows.length === 0) {
    return new Response('Playlist is empty or does not exist', { status: 404 })
  }

  if (from >= rows.length) {
    return new Response(
      `from index ${from} is past the end of a ${rows.length}-track playlist`,
      { status: 416 }
    )
  }

  // Everything past this point concerns only the tracks actually being served.
  const served = rows.slice(from)

  // Every track needs a measured length: the whole point of planning up front
  // is an exact Content-Length without opening any files.
  const unmeasured = served.find((r) => !r.audioBytes)
  if (unmeasured) {
    return new Response(`Track ${unmeasured.mediaId} has no measured audio length`, {
      status: 409,
    })
  }

  const incompatible = findIncompatibleTrack(served)
  if (incompatible) {
    // Concatenating these would hand the decoder a mid-stream format change.
    // Fail loudly rather than emit a stream that breaks partway through.
    return new Response(
      `Track ${incompatible.mediaId} cannot be concatenated: ${incompatible.reason}`,
      { status: 409 }
    )
  }

  const tracks: PlannedTrack[] = served.map((r) => ({
    mediaId: r.mediaId,
    title: r.title,
    audioBytes: r.audioBytes!,
    path: playablePath(r),
  }))

  const wantsMetadata = request.headers.get('icy-metadata') === '1'
  const plan = planPlaylistStream(tracks, wantsMetadata)

  const headers: Record<string, string> = {
    'Content-Type': 'audio/mpeg',
    // Seeking into a concatenated stream has no meaning — byte offsets don't
    // correspond to anything a client can reason about.
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-cache',
  }

  if (wantsMetadata) {
    // Deliberately NO Content-Length here.
    //
    // ESP32-audioI2S decides how to read a response by precedence: a non-zero
    // Content-Length makes it a "web file", and the web-file path has no ICY
    // metadata handling whatsoever — every metadata block would be fed to the
    // decoder as audio, corrupting the stream roughly once per metaint. Only
    // the chunked path pairs with metadata (Audio.cpp: `if(m_f_chunked &&
    // m_f_metadata) m_streamType = ST_WEBSTREAM`).
    //
    // Omitting Content-Length lets the response fall back to chunked transfer
    // encoding, which is what makes the device treat this as a metadata-
    // carrying stream. plan.totalBytes stays useful for logging and tests.
    headers['icy-metaint'] = String(ICY_METAINT)
  } else {
    // Plain concatenated audio for anything that didn't ask for metadata —
    // a browser, or curl. A known length is friendlier there.
    headers['Content-Length'] = String(plan.totalBytes)
  }

  return new Response(withBody ? streamPlan(plan) : null, { headers })
}

/**
 * Emit the planned bytes, reading one track at a time.
 *
 * Files are opened lazily so time-to-first-byte depends only on the first
 * track, and memory holds at most one track's frames — a long playlist must
 * not mean reading hundreds of MB before the device hears anything.
 */
function streamPlan(plan: StreamPlan): ReadableStream {
  let index = 0
  let loadedPath: string | null = null
  let loadedAudio: Buffer | null = null

  return new ReadableStream({
    async pull(controller) {
      while (index < plan.parts.length) {
        const part = plan.parts[index++]

        if (part.kind === 'metadata') {
          controller.enqueue(new Uint8Array(part.bytes))
          continue
        }

        if (loadedPath !== part.track.path) {
          const file = await fs.readFile(join(DATA_DIR, part.track.path))
          loadedAudio = extractAudioFrames(file).audio
          loadedPath = part.track.path

          if (loadedAudio.length !== part.track.audioBytes) {
            // Content-Length came from the stored length, so a file that has
            // changed since ingest would desync the response. Files are never
            // rewritten in place, so this means something outside the app
            // touched them.
            controller.error(
              new Error(
                `Track ${part.track.mediaId} is ${loadedAudio.length}B but was recorded as ${part.track.audioBytes}B`
              )
            )
            return
          }
        }

        controller.enqueue(
          new Uint8Array(loadedAudio!.subarray(part.offset, part.offset + part.length))
        )
        return
      }

      loadedAudio = null
      controller.close()
    },

    cancel() {
      loadedAudio = null
    },
  })
}
