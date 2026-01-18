import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  cards,
  playlistSongs,
  playlists,
  podcastFeeds,
  songs,
} from '@/db/schema'
import { nfcQueue } from '@/lib/nfc-queue'
import { getLatestEpisodeForFeed } from '@/services/podcastService'
import * as devicesService from '@/services/devicesService'

export const Route = createFileRoute('/api/nfc/scan')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json()
          const { secret, nfcId } = body

          if (!secret || !nfcId) {
            return Response.json(
              {
                error: 'Missing required fields: secret and nfcId',
              },
              { status: 400 },
            )
          }

          // Authenticate device by secret
          const device = await devicesService.getDeviceBySecret(secret)
          if (!device) {
            console.warn(`[nfc/scan] Invalid device secret`)
            return Response.json(
              { error: 'Invalid device secret' },
              { status: 401 },
            )
          }

          const deviceId = device.id
          console.log(
            `📡 NFC scan received: ${nfcId} from device ${deviceId} (${device.name})`,
          )

          // Look up the card mapping
          const cardMapping = await db
            .select()
            .from(cards)
            .where(eq(cards.nfcId, nfcId))
            .limit(1)

          if (cardMapping.length === 0) {
            console.log(`❌ Card ${nfcId} not registered`)
            // Still add to queue for web UI registration flow
            nfcQueue.addScan(String(deviceId), nfcId)

            return Response.json(
              {
                error: 'Card not registered',
                nfcId,
              },
              { status: 422 },
            )
          }

          const card = cardMapping[0]
          console.log(`✅ Card ${nfcId} mapped to ${card.contentType}`)

          // Add to queue for web UI notifications
          nfcQueue.addScan(String(deviceId), nfcId)

          // Build response based on content type
          let content = null

          if (card.contentType === 'song' && card.contentPath) {
            // Fetch song metadata (without file data)
            const songId = parseInt(card.contentPath, 10)
            const songData = await db
              .select({
                id: songs.id,
                title: songs.title,
                artist: songs.artist,
                album: songs.album,
                duration: songs.duration,
                mimeType: songs.mimeType,
                fileSize: songs.fileSize,
              })
              .from(songs)
              .where(eq(songs.id, songId))
              .limit(1)

            if (songData.length > 0) {
              content = {
                type: 'song',
                song: songData[0],
              }
            }
          } else if (card.contentType === 'playlist' && card.contentPath) {
            // Fetch playlist with songs
            const playlistId = parseInt(card.contentPath, 10)
            const playlistData = await db
              .select()
              .from(playlists)
              .where(eq(playlists.id, playlistId))
              .limit(1)

            if (playlistData.length > 0) {
              // Fetch playlist songs
              const playlistTracks = await db
                .select({
                  position: playlistSongs.position,
                  id: songs.id,
                  title: songs.title,
                  artist: songs.artist,
                  album: songs.album,
                  duration: songs.duration,
                  mimeType: songs.mimeType,
                  fileSize: songs.fileSize,
                })
                .from(playlistSongs)
                .innerJoin(songs, eq(playlistSongs.songId, songs.id))
                .where(eq(playlistSongs.playlistId, playlistId))
                .orderBy(playlistSongs.position)

              content = {
                type: 'playlist',
                playlist: {
                  ...playlistData[0],
                  songs: playlistTracks,
                },
              }
            }
          } else if (card.contentType === 'action' && card.action) {
            content = {
              type: 'action',
              action: card.action,
            }
          } else if (card.contentType === 'podcast' && card.contentPath) {
            // Fetch podcast feed and latest episode
            const feedId = parseInt(card.contentPath, 10)
            const feedData = await db
              .select()
              .from(podcastFeeds)
              .where(eq(podcastFeeds.id, feedId))
              .limit(1)

            if (feedData.length > 0) {
              const feed = feedData[0]
              const latestEpisode = await getLatestEpisodeForFeed(feedId)

              content = {
                type: 'podcast',
                podcast: {
                  id: feed.id,
                  title: feed.title,
                  description: feed.description,
                  imageUrl: feed.imageUrl,
                  author: feed.author,
                  latestEpisode: latestEpisode
                    ? {
                        id: latestEpisode.id,
                        feedId: latestEpisode.feedId,
                        title: latestEpisode.title,
                        description: latestEpisode.description,
                        duration: latestEpisode.duration,
                        publishedAt: latestEpisode.publishedAt,
                        mimeType: latestEpisode.mimeType,
                        fileSize: latestEpisode.fileSize,
                        downloadStatus: latestEpisode.downloadStatus,
                      }
                    : null,
                },
              }
            }
          }

          return Response.json({
            success: true,
            nfcId: card.nfcId,
            contentType: card.contentType,
            content,
          })
        } catch (error) {
          console.error('NFC scan endpoint error:', error)
          return Response.json(
            { error: 'Failed to process NFC scan' },
            { status: 500 },
          )
        }
      },
    },
  },
})
