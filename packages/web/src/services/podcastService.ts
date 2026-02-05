import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import Parser from 'rss-parser'
import { eq, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { podcastFeeds, media } from '../db/schema.js'

const DATA_ROOT = path.join(process.cwd(), 'data')
const parser = new Parser()

interface PodcastMetadata {
  feedId?: number
  guid?: string
  pubDate?: string
  description?: string | null
  audioUrl?: string
  downloadStatus?: 'pending' | 'downloading' | 'complete' | 'failed'
}

export interface PodcastEpisode {
  guid: string
  title: string
  pubDate: Date | null
  duration: number | null
  audioUrl: string
  description: string | null
}

function parseMetadata(metadata: unknown): PodcastMetadata {
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata)
    } catch {
      return {}
    }
  }
  if (metadata && typeof metadata === 'object') {
    return metadata as PodcastMetadata
  }
  return {}
}

/**
 * Add a new podcast feed
 */
export async function addPodcastFeed(feedUrl: string, retentionCount = 3): Promise<{
  id: number
  name: string
  imageUrl: string | null
}> {
  // Validate retention count
  if (retentionCount < 1 || retentionCount > 10) {
    throw new Error('Retention count must be between 1 and 10')
  }

  // Check if feed already exists
  const existing = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.feedUrl, feedUrl))
    .limit(1)

  if (existing.length > 0) {
    throw new Error('Feed already exists')
  }

  // Fetch and parse the feed to get metadata
  const feed = await parser.parseURL(feedUrl)

  if (!feed.title) {
    throw new Error('Invalid podcast feed: missing title')
  }

  // Insert the feed
  const [newFeed] = await db
    .insert(podcastFeeds)
    .values({
      name: feed.title,
      feedUrl,
      imageUrl: feed.image?.url || feed.itunes?.image || null,
      retentionCount,
    })
    .returning()

  // Kick off episode downloads in the background (don't await)
  refreshFeed(newFeed.id).catch((err) => {
    console.error(`[Podcasts] Background refresh failed for feed ${newFeed.id}:`, err)
  })

  return {
    id: newFeed.id,
    name: newFeed.name,
    imageUrl: newFeed.imageUrl,
  }
}

/**
 * Get all podcast feeds
 */
export async function getPodcastFeeds() {
  const feeds = await db
    .select()
    .from(podcastFeeds)
    .orderBy(desc(podcastFeeds.createdAt))

  // Get episode counts for each feed
  const feedsWithCounts = await Promise.all(
    feeds.map(async (feed) => {
      const episodes = await db
        .select()
        .from(media)
        .where(eq(media.type, 'podcast'))

      // Filter episodes that belong to this feed
      const feedEpisodes = episodes.filter((ep) => {
        const metadata = parseMetadata(ep.metadata)
        return metadata.feedId === feed.id
      })

      return {
        ...feed,
        episodeCount: feedEpisodes.length,
      }
    })
  )

  return feedsWithCounts
}

/**
 * Get a single podcast feed with its episodes
 */
export async function getPodcastFeed(feedId: number) {
  const [feed] = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.id, feedId))
    .limit(1)

  if (!feed) {
    throw new Error('Feed not found')
  }

  // Get episodes for this feed
  const allPodcasts = await db
    .select()
    .from(media)
    .where(eq(media.type, 'podcast'))

  const episodes = allPodcasts
    .filter((ep) => {
      const metadata = parseMetadata(ep.metadata)
      return metadata.feedId === feedId
    })
    .sort((a, b) => {
      // Sort by pubDate descending (newest first)
      const metaA = parseMetadata(a.metadata)
      const metaB = parseMetadata(b.metadata)
      const dateA = metaA.pubDate ? new Date(metaA.pubDate).getTime() : 0
      const dateB = metaB.pubDate ? new Date(metaB.pubDate).getTime() : 0
      return dateB - dateA
    })

  return {
    ...feed,
    episodes,
  }
}

/**
 * Delete a podcast feed and its episodes
 */
export async function deletePodcastFeed(feedId: number) {
  // Get all episodes for this feed
  const allPodcasts = await db
    .select()
    .from(media)
    .where(eq(media.type, 'podcast'))

  const episodeIds = allPodcasts
    .filter((ep) => {
      const metadata = parseMetadata(ep.metadata)
      return metadata.feedId === feedId
    })
    .map((ep) => ep.id)

  // Delete episode files
  for (const id of episodeIds) {
    const [episode] = await db
      .select()
      .from(media)
      .where(eq(media.id, id))
      .limit(1)

    if (episode) {
      const filePath = path.join(DATA_ROOT, episode.filePath)
      try {
        await fs.unlink(filePath)
      } catch {
        // File may not exist, continue
      }
    }
  }

  // Delete media entries
  if (episodeIds.length > 0) {
    await db.delete(media).where(inArray(media.id, episodeIds))
  }

  // Delete the feed
  await db.delete(podcastFeeds).where(eq(podcastFeeds.id, feedId))
}

/**
 * Update feed settings
 */
export async function updatePodcastFeed(
  feedId: number,
  updates: { name?: string; retentionCount?: number }
) {
  if (updates.retentionCount !== undefined) {
    if (updates.retentionCount < 1 || updates.retentionCount > 10) {
      throw new Error('Retention count must be between 1 and 10')
    }
  }

  const [updated] = await db
    .update(podcastFeeds)
    .set(updates)
    .where(eq(podcastFeeds.id, feedId))
    .returning()

  if (!updated) {
    throw new Error('Feed not found')
  }

  // If retention count changed, clean up old episodes
  if (updates.retentionCount !== undefined) {
    await cleanupOldEpisodes(feedId)
  }

  return updated
}

/**
 * Refresh a single feed - fetch new episodes
 */
export async function refreshFeed(feedId: number) {
  const [feed] = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.id, feedId))
    .limit(1)

  if (!feed) {
    throw new Error('Feed not found')
  }

  // Parse the RSS feed
  const parsedFeed = await parser.parseURL(feed.feedUrl)

  // Get existing episode GUIDs for this feed
  const existingPodcasts = await db
    .select()
    .from(media)
    .where(eq(media.type, 'podcast'))

  const existingGuids = new Set(
    existingPodcasts
      .filter((ep) => {
        const metadata = parseMetadata(ep.metadata)
        return metadata.feedId === feedId
      })
      .map((ep) => {
        const metadata = parseMetadata(ep.metadata)
        return metadata.guid
      })
  )

  // Get new episodes (up to retention count)
  const newEpisodes = (parsedFeed.items || [])
    .filter((item) => {
      const guid = item.guid || item.link || item.title
      return guid && !existingGuids.has(guid)
    })
    .slice(0, feed.retentionCount)

  // First, insert all episodes as "pending" so UI can show them immediately
  const pendingEpisodes: { id: number; episode: PodcastEpisode }[] = []

  for (const episode of newEpisodes) {
    const audioUrl = episode.enclosure?.url
    if (!audioUrl) continue

    const guid = episode.guid || episode.link || episode.title
    if (!guid) continue

    // Parse duration from iTunes duration or content
    let duration: number | null = null
    if (episode.itunes?.duration) {
      const parts = episode.itunes.duration.split(':').map(Number)
      if (parts.length === 3) {
        duration = parts[0] * 3600 + parts[1] * 60 + parts[2]
      } else if (parts.length === 2) {
        duration = parts[0] * 60 + parts[1]
      } else if (parts.length === 1) {
        duration = parts[0]
      }
    }

    // Insert as pending
    const [inserted] = await db.insert(media).values({
      type: 'podcast',
      title: episode.title || 'Untitled Episode',
      duration,
      mimeType: 'audio/mpeg',
      fileSize: null,
      filePath: '', // Empty until downloaded
      metadata: {
        feedId,
        guid,
        pubDate: episode.pubDate ? new Date(episode.pubDate).toISOString() : null,
        description: episode.contentSnippet || episode.content || null,
        audioUrl,
        downloadStatus: 'pending',
      },
    }).returning()

    pendingEpisodes.push({
      id: inserted.id,
      episode: {
        guid,
        title: episode.title || 'Untitled Episode',
        pubDate: episode.pubDate ? new Date(episode.pubDate) : null,
        duration,
        audioUrl,
        description: episode.contentSnippet || episode.content || null,
      },
    })
  }

  // Update last fetched timestamp
  await db
    .update(podcastFeeds)
    .set({ lastFetchedAt: new Date() })
    .where(eq(podcastFeeds.id, feedId))

  // Now download each episode in background
  for (const { id, episode } of pendingEpisodes) {
    await downloadEpisodeById(id, episode)
  }

  // Cleanup old episodes
  await cleanupOldEpisodes(feedId)
}

/**
 * Refresh all feeds
 */
export async function refreshAllFeeds() {
  const feeds = await db.select().from(podcastFeeds)

  const results = await Promise.allSettled(
    feeds.map((feed) => refreshFeed(feed.id))
  )

  const succeeded = results.filter((r) => r.status === 'fulfilled').length
  const failed = results.filter((r) => r.status === 'rejected').length

  return { succeeded, failed, total: feeds.length }
}

/**
 * Download a podcast episode by its media ID (updates existing pending record)
 */
async function downloadEpisodeById(mediaId: number, episode: PodcastEpisode) {
  const podcastsDir = path.join(DATA_ROOT, 'podcasts')
  await fs.mkdir(podcastsDir, { recursive: true })

  const uuid = crypto.randomUUID()
  const outputPath = path.join(podcastsDir, `${uuid}.mp3`)

  // Get existing record to get feedId from metadata
  const [existing] = await db
    .select()
    .from(media)
    .where(eq(media.id, mediaId))
    .limit(1)

  if (!existing) return

  const existingMeta = parseMetadata(existing.metadata)

  // Update status to downloading
  await db.update(media).set({
    metadata: {
      ...existingMeta,
      downloadStatus: 'downloading',
    },
  }).where(eq(media.id, mediaId))

  try {
    // Download using curl (simpler than yt-dlp for direct URLs)
    await new Promise<void>((resolve, reject) => {
      const curl = spawn('curl', ['-L', '-o', outputPath, episode.audioUrl])

      curl.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`curl exited with code ${code}`))
        }
      })

      curl.on('error', reject)
    })

    // Get file stats
    const stats = await fs.stat(outputPath)

    // Determine mime type from URL or default to audio/mpeg
    let mimeType = 'audio/mpeg'
    if (episode.audioUrl.includes('.m4a')) {
      mimeType = 'audio/mp4'
    } else if (episode.audioUrl.includes('.ogg')) {
      mimeType = 'audio/ogg'
    }

    // Update the existing media entry with file info
    await db.update(media).set({
      mimeType,
      fileSize: stats.size,
      filePath: `podcasts/${uuid}.mp3`,
      metadata: {
        ...existingMeta,
        downloadStatus: 'complete',
      },
    }).where(eq(media.id, mediaId))
  } catch (error) {
    // Cleanup partial file on error
    try {
      await fs.unlink(outputPath)
    } catch {
      // Ignore cleanup errors
    }

    // Update status to failed
    await db.update(media).set({
      metadata: {
        ...existingMeta,
        downloadStatus: 'failed',
      },
    }).where(eq(media.id, mediaId))

    console.error(`Failed to download episode "${episode.title}":`, error)
  }
}

/**
 * Clean up old episodes beyond retention count
 */
async function cleanupOldEpisodes(feedId: number) {
  const [feed] = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.id, feedId))
    .limit(1)

  if (!feed) return

  // Get all episodes for this feed, sorted by pubDate descending
  const allPodcasts = await db
    .select()
    .from(media)
    .where(eq(media.type, 'podcast'))

  const feedEpisodes = allPodcasts
    .filter((ep) => {
      const metadata = parseMetadata(ep.metadata)
      return metadata.feedId === feedId
    })
    .sort((a, b) => {
      const metaA = parseMetadata(a.metadata)
      const metaB = parseMetadata(b.metadata)
      const dateA = metaA.pubDate ? new Date(metaA.pubDate).getTime() : 0
      const dateB = metaB.pubDate ? new Date(metaB.pubDate).getTime() : 0
      return dateB - dateA
    })

  // Delete episodes beyond retention count
  const episodesToDelete = feedEpisodes.slice(feed.retentionCount)

  for (const episode of episodesToDelete) {
    // Delete file
    const filePath = path.join(DATA_ROOT, episode.filePath)
    try {
      await fs.unlink(filePath)
    } catch {
      // File may not exist
    }

    // Delete media entry
    await db.delete(media).where(eq(media.id, episode.id))
  }
}

/**
 * Get the latest episode for a feed (used when playing via card)
 */
export async function getLatestEpisode(feedId: number) {
  const allPodcasts = await db
    .select()
    .from(media)
    .where(eq(media.type, 'podcast'))

  const feedEpisodes = allPodcasts
    .filter((ep) => {
      const metadata = parseMetadata(ep.metadata)
      return metadata.feedId === feedId
    })
    .sort((a, b) => {
      const metaA = parseMetadata(a.metadata)
      const metaB = parseMetadata(b.metadata)
      const dateA = metaA.pubDate ? new Date(metaA.pubDate).getTime() : 0
      const dateB = metaB.pubDate ? new Date(metaB.pubDate).getTime() : 0
      return dateB - dateA
    })

  return feedEpisodes[0] || null
}
