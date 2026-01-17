import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import type {
  NewPodcastEpisode,
  NewPodcastFeed,
  PodcastEpisode,
  PodcastFeed,
} from '@/db/schema'
import { db } from '@/db'
import { devices, podcastEpisodes, podcastFeeds } from '@/db/schema'

// ============================================================================
// RSS Parsing Types
// ============================================================================

interface RSSItem {
  guid: string
  title: string
  description?: string
  pubDate?: string
  enclosure?: {
    url: string
    type?: string
    length?: string
  }
  duration?: number // iTunes duration in seconds
}

interface RSSFeed {
  title: string
  description?: string
  author?: string
  imageUrl?: string
  items: Array<RSSItem>
}

// ============================================================================
// RSS Parsing
// ============================================================================

/**
 * Parse an RSS/Atom feed from XML string
 */
function parseRSSFeed(xml: string): RSSFeed {
  // Simple regex-based XML parsing for RSS feeds
  const getTagContent = (
    xmlContent: string,
    tag: string,
    defaultValue = '',
  ): string => {
    // Try CDATA first
    const cdataRegex = new RegExp(
      `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
      'i',
    )
    const cdataMatch = xmlContent.match(cdataRegex)
    if (cdataMatch) return cdataMatch[1].trim()

    // Try regular content
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const match = xmlContent.match(regex)
    return match ? match[1].trim() : defaultValue
  }

  const getAttributeValue = (
    tag: string,
    attr: string,
    defaultValue = '',
  ): string => {
    const regex = new RegExp(`${attr}=["']([^"']*)["']`, 'i')
    const match = tag.match(regex)
    return match ? match[1] : defaultValue
  }

  // Extract channel info
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i)
  const channelXml = channelMatch ? channelMatch[1] : xml

  const title = getTagContent(channelXml, 'title', 'Unknown Podcast')
  const description = getTagContent(channelXml, 'description')
  const author =
    getTagContent(channelXml, 'itunes:author') ||
    getTagContent(channelXml, 'author')

  // Get image URL
  const itunesImageMatch = channelXml.match(
    /<itunes:image[^>]*href=["']([^"']*)["'][^>]*\/?>/i,
  )
  const regularImageMatch = channelXml.match(
    /<image>[\s\S]*?<url>([^<]*)<\/url>[\s\S]*?<\/image>/i,
  )
  const imageUrl = itunesImageMatch?.[1] || regularImageMatch?.[1] || ''

  // Parse items
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi
  const items: Array<RSSItem> = []
  let itemMatch

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemXml = itemMatch[1]

    // Get enclosure
    const enclosureMatch = itemXml.match(/<enclosure[^>]*\/?>/i)
    let enclosure: RSSItem['enclosure'] | undefined

    if (enclosureMatch) {
      const enclosureTag = enclosureMatch[0]
      enclosure = {
        url: getAttributeValue(enclosureTag, 'url'),
        type: getAttributeValue(enclosureTag, 'type'),
        length: getAttributeValue(enclosureTag, 'length'),
      }
    }

    // Skip items without audio enclosure
    if (!enclosure?.url) continue

    // Get guid (use enclosure URL as fallback)
    const guid =
      getTagContent(itemXml, 'guid') ||
      getTagContent(itemXml, 'link') ||
      enclosure.url

    // Parse iTunes duration (can be in seconds or HH:MM:SS format)
    const durationStr = getTagContent(itemXml, 'itunes:duration')
    let duration: number | undefined

    if (durationStr) {
      if (durationStr.includes(':')) {
        // Parse HH:MM:SS or MM:SS
        const parts = durationStr.split(':').map(Number)
        if (parts.length === 3) {
          duration = parts[0] * 3600 + parts[1] * 60 + parts[2]
        } else if (parts.length === 2) {
          duration = parts[0] * 60 + parts[1]
        }
      } else {
        duration = parseInt(durationStr, 10)
      }
    }

    items.push({
      guid,
      title: getTagContent(itemXml, 'title', 'Untitled Episode'),
      description:
        getTagContent(itemXml, 'description') ||
        getTagContent(itemXml, 'itunes:summary'),
      pubDate: getTagContent(itemXml, 'pubDate'),
      enclosure,
      duration,
    })
  }

  return { title, description, author, imageUrl, items }
}

/**
 * Fetch and parse an RSS feed from a URL
 */
export async function fetchRSSFeed(feedUrl: string): Promise<RSSFeed> {
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'MusicBox/1.0 (Podcast Player)',
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`)
  }

  const xml = await response.text()
  return parseRSSFeed(xml)
}

// ============================================================================
// Feed Management
// ============================================================================

/**
 * Add a new podcast feed by URL
 */
export async function addPodcastFeed(
  feedUrl: string,
): Promise<{ feed: PodcastFeed; episodeCount: number }> {
  // Check if feed already exists
  const existing = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.feedUrl, feedUrl))
    .limit(1)

  if (existing.length > 0) {
    throw new Error('Podcast feed already exists')
  }

  // Fetch and parse the feed
  const rssFeed = await fetchRSSFeed(feedUrl)

  // Insert the feed
  const [feed] = await db
    .insert(podcastFeeds)
    .values({
      title: rssFeed.title,
      feedUrl,
      description: rssFeed.description || null,
      imageUrl: rssFeed.imageUrl || null,
      author: rssFeed.author || null,
      lastFetchedAt: new Date(),
    } satisfies NewPodcastFeed)
    .returning()

  // Insert episodes (most recent first based on pubDate, limit to episodesToKeep)
  const sortedItems = rssFeed.items.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0
    return dateB - dateA
  })

  const episodesToKeep = feed.episodesToKeep ?? 3
  const itemsToInsert = sortedItems.slice(0, episodesToKeep)

  for (const item of itemsToInsert) {
    if (!item.enclosure?.url) continue

    await db.insert(podcastEpisodes).values({
      feedId: feed.id,
      guid: item.guid,
      title: item.title,
      description: item.description || null,
      duration: item.duration || null,
      publishedAt: item.pubDate ? new Date(item.pubDate) : null,
      sourceUrl: item.enclosure.url,
      mimeType: item.enclosure.type || 'audio/mpeg',
      downloadStatus: 'pending',
    } satisfies NewPodcastEpisode)
  }

  return { feed, episodeCount: itemsToInsert.length }
}

/**
 * Get all podcast feeds
 */
export async function getAllPodcastFeeds(): Promise<Array<PodcastFeed>> {
  return db.select().from(podcastFeeds).orderBy(desc(podcastFeeds.createdAt))
}

/**
 * Get a podcast feed by ID with episode count
 */
export async function getPodcastFeedById(
  feedId: number,
): Promise<PodcastFeed | null> {
  const result = await db
    .select()
    .from(podcastFeeds)
    .where(eq(podcastFeeds.id, feedId))
    .limit(1)

  return result[0] || null
}

/**
 * Delete a podcast feed and all its episodes
 */
export async function deletePodcastFeed(feedId: number): Promise<void> {
  await db.delete(podcastFeeds).where(eq(podcastFeeds.id, feedId))
}

/**
 * Update feed settings
 */
export async function updatePodcastFeed(
  feedId: number,
  updates: { episodesToKeep?: number },
): Promise<PodcastFeed | null> {
  const result = await db
    .update(podcastFeeds)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(podcastFeeds.id, feedId))
    .returning()

  return result[0] ?? null
}

// ============================================================================
// Episode Management
// ============================================================================

/**
 * Get episodes for a feed
 */
export async function getEpisodesByFeedId(
  feedId: number,
): Promise<Array<PodcastEpisode>> {
  return db
    .select()
    .from(podcastEpisodes)
    .where(eq(podcastEpisodes.feedId, feedId))
    .orderBy(desc(podcastEpisodes.publishedAt))
}

/**
 * Get a single episode by ID (without file data for metadata queries)
 */
export async function getEpisodeById(
  episodeId: number,
): Promise<Omit<PodcastEpisode, 'fileData'> | null> {
  const result = await db
    .select({
      id: podcastEpisodes.id,
      feedId: podcastEpisodes.feedId,
      guid: podcastEpisodes.guid,
      title: podcastEpisodes.title,
      description: podcastEpisodes.description,
      duration: podcastEpisodes.duration,
      publishedAt: podcastEpisodes.publishedAt,
      mimeType: podcastEpisodes.mimeType,
      fileSize: podcastEpisodes.fileSize,
      sourceUrl: podcastEpisodes.sourceUrl,
      downloadStatus: podcastEpisodes.downloadStatus,
      downloadError: podcastEpisodes.downloadError,
      listenedAt: podcastEpisodes.listenedAt,
      createdAt: podcastEpisodes.createdAt,
    })
    .from(podcastEpisodes)
    .where(eq(podcastEpisodes.id, episodeId))
    .limit(1)

  return result[0] || null
}

/**
 * Get episode with file data for streaming
 */
export async function getEpisodeWithFileData(
  episodeId: number,
): Promise<PodcastEpisode | null> {
  const result = await db
    .select()
    .from(podcastEpisodes)
    .where(eq(podcastEpisodes.id, episodeId))
    .limit(1)

  return result[0] || null
}

/**
 * Get the latest downloaded episode for a feed
 */
export async function getLatestEpisodeForFeed(
  feedId: number,
): Promise<Omit<PodcastEpisode, 'fileData'> | null> {
  const result = await db
    .select({
      id: podcastEpisodes.id,
      feedId: podcastEpisodes.feedId,
      guid: podcastEpisodes.guid,
      title: podcastEpisodes.title,
      description: podcastEpisodes.description,
      duration: podcastEpisodes.duration,
      publishedAt: podcastEpisodes.publishedAt,
      mimeType: podcastEpisodes.mimeType,
      fileSize: podcastEpisodes.fileSize,
      sourceUrl: podcastEpisodes.sourceUrl,
      downloadStatus: podcastEpisodes.downloadStatus,
      downloadError: podcastEpisodes.downloadError,
      listenedAt: podcastEpisodes.listenedAt,
      createdAt: podcastEpisodes.createdAt,
    })
    .from(podcastEpisodes)
    .where(
      and(
        eq(podcastEpisodes.feedId, feedId),
        eq(podcastEpisodes.downloadStatus, 'complete'),
      ),
    )
    .orderBy(desc(podcastEpisodes.publishedAt))
    .limit(1)

  return result[0] || null
}

/**
 * Mark an episode as listened
 */
export async function markEpisodeListened(episodeId: number): Promise<void> {
  await db
    .update(podcastEpisodes)
    .set({ listenedAt: new Date() })
    .where(eq(podcastEpisodes.id, episodeId))
}

// ============================================================================
// Episode Download
// ============================================================================

/**
 * Download an episode's audio file and store in database
 */
export async function downloadEpisode(episodeId: number): Promise<void> {
  const episode = await getEpisodeById(episodeId)
  if (!episode) {
    throw new Error(`Episode ${episodeId} not found`)
  }

  if (episode.downloadStatus === 'complete') {
    console.log(`Episode ${episodeId} already downloaded, skipping`)
    return
  }

  if (episode.downloadStatus === 'downloading') {
    console.log(`Episode ${episodeId} is already downloading, skipping`)
    return
  }

  console.log(`Downloading episode: ${episode.title}`)

  // Mark as downloading
  await db
    .update(podcastEpisodes)
    .set({ downloadStatus: 'downloading', downloadError: null })
    .where(eq(podcastEpisodes.id, episodeId))

  try {
    const response = await fetch(episode.sourceUrl, {
      headers: {
        'User-Agent': 'MusicBox/1.0 (Podcast Player)',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const contentType = response.headers.get('content-type') || episode.mimeType
    const contentLength = response.headers.get('content-length')
    const fileSize = contentLength ? parseInt(contentLength, 10) : null

    // Read the response as a buffer
    const arrayBuffer = await response.arrayBuffer()
    const fileData = Buffer.from(arrayBuffer)

    // Update episode with file data
    await db
      .update(podcastEpisodes)
      .set({
        fileData,
        mimeType: contentType || 'audio/mpeg',
        fileSize: fileSize || fileData.length,
        downloadStatus: 'complete',
        downloadError: null,
      })
      .where(eq(podcastEpisodes.id, episodeId))

    console.log(
      `Downloaded episode: ${episode.title} (${(fileData.length / 1024 / 1024).toFixed(1)} MB)`,
    )
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    console.error(`Failed to download episode ${episodeId}:`, errorMessage)

    await db
      .update(podcastEpisodes)
      .set({
        downloadStatus: 'failed',
        downloadError: errorMessage,
      })
      .where(eq(podcastEpisodes.id, episodeId))
  }
}

/**
 * Download all pending episodes for a feed
 */
export async function downloadPendingEpisodes(feedId: number): Promise<void> {
  const pendingEpisodes = await db
    .select({ id: podcastEpisodes.id })
    .from(podcastEpisodes)
    .where(
      and(
        eq(podcastEpisodes.feedId, feedId),
        eq(podcastEpisodes.downloadStatus, 'pending'),
      ),
    )
    .orderBy(desc(podcastEpisodes.publishedAt))

  for (const episode of pendingEpisodes) {
    await downloadEpisode(episode.id)
  }
}

// ============================================================================
// Feed Refresh & Cleanup
// ============================================================================

/**
 * Refresh a feed: fetch new episodes and clean up old ones
 */
export async function refreshFeed(feedId: number): Promise<{
  newEpisodes: number
  deletedEpisodes: number
}> {
  const feed = await getPodcastFeedById(feedId)
  if (!feed) {
    throw new Error(`Feed ${feedId} not found`)
  }

  console.log(`Refreshing feed: ${feed.title}`)

  const rssFeed = await fetchRSSFeed(feed.feedUrl)

  // Get existing episode guids
  const existingEpisodes = await db
    .select({ guid: podcastEpisodes.guid })
    .from(podcastEpisodes)
    .where(eq(podcastEpisodes.feedId, feedId))

  const existingGuids = new Set(existingEpisodes.map((e) => e.guid))

  // Sort items by date (most recent first)
  const sortedItems = rssFeed.items.sort((a, b) => {
    const dateA = a.pubDate ? new Date(a.pubDate).getTime() : 0
    const dateB = b.pubDate ? new Date(b.pubDate).getTime() : 0
    return dateB - dateA
  })

  // Find new episodes
  const newItems = sortedItems.filter(
    (item) => item.enclosure?.url && !existingGuids.has(item.guid),
  )

  // Insert new episodes
  let newEpisodes = 0
  for (const item of newItems) {
    if (!item.enclosure?.url) continue

    await db.insert(podcastEpisodes).values({
      feedId: feed.id,
      guid: item.guid,
      title: item.title,
      description: item.description || null,
      duration: item.duration || null,
      publishedAt: item.pubDate ? new Date(item.pubDate) : null,
      sourceUrl: item.enclosure.url,
      mimeType: item.enclosure.type || 'audio/mpeg',
      downloadStatus: 'pending',
    } satisfies NewPodcastEpisode)
    newEpisodes++
  }

  // Update last fetched time
  await db
    .update(podcastFeeds)
    .set({ lastFetchedAt: new Date() })
    .where(eq(podcastFeeds.id, feedId))

  // Cleanup old episodes
  const deletedEpisodes = await cleanupOldEpisodes(feedId)

  console.log(
    `Feed ${feed.title}: ${newEpisodes} new, ${deletedEpisodes} deleted`,
  )

  return { newEpisodes, deletedEpisodes }
}

/**
 * Clean up old episodes based on retention rules
 */
async function cleanupOldEpisodes(feedId: number): Promise<number> {
  const feed = await getPodcastFeedById(feedId)
  if (!feed) return 0

  const episodesToKeep = feed.episodesToKeep ?? 3

  // Get all episodes ordered by published date
  const allEpisodes = await db
    .select({
      id: podcastEpisodes.id,
      publishedAt: podcastEpisodes.publishedAt,
      downloadStatus: podcastEpisodes.downloadStatus,
      listenedAt: podcastEpisodes.listenedAt,
    })
    .from(podcastEpisodes)
    .where(eq(podcastEpisodes.feedId, feedId))
    .orderBy(desc(podcastEpisodes.publishedAt))

  if (allEpisodes.length <= episodesToKeep) {
    return 0
  }

  // Get currently playing episodes across all devices
  const devicesWithPodcasts = await db
    .select({ currentSong: devices.currentSong })
    .from(devices)
    .where(isNotNull(devices.currentSong))

  const playingEpisodeIds = new Set<number>()
  for (const device of devicesWithPodcasts) {
    if (device.currentSong) {
      try {
        const parsed = JSON.parse(device.currentSong)
        if (parsed.episodeId) {
          playingEpisodeIds.add(parsed.episodeId)
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Calculate 7 days ago for listened protection
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // Find episodes to delete
  const episodesToDelete: Array<number> = []

  for (let i = episodesToKeep; i < allEpisodes.length; i++) {
    const episode = allEpisodes[i]

    // Never delete currently playing episodes
    if (playingEpisodeIds.has(episode.id)) continue

    // Never delete episodes still downloading
    if (episode.downloadStatus === 'downloading') continue

    // Never delete episodes listened to in last 7 days
    if (episode.listenedAt && episode.listenedAt > sevenDaysAgo) continue

    episodesToDelete.push(episode.id)
  }

  if (episodesToDelete.length > 0) {
    await db
      .delete(podcastEpisodes)
      .where(
        and(
          eq(podcastEpisodes.feedId, feedId),
          sql`${podcastEpisodes.id} IN (${sql.join(episodesToDelete.map((id) => sql`${id}`), sql`, `)})`,
        ),
      )
  }

  return episodesToDelete.length
}

/**
 * Check all feeds for new episodes
 */
export async function checkAllFeeds(): Promise<void> {
  console.log('Checking all podcast feeds...')

  const feeds = await getAllPodcastFeeds()

  for (const feed of feeds) {
    try {
      const result = await refreshFeed(feed.id)

      // Download any pending episodes
      if (result.newEpisodes > 0) {
        await downloadPendingEpisodes(feed.id)
      }
    } catch (error) {
      console.error(`Failed to refresh feed ${feed.title}:`, error)
    }
  }

  console.log('Finished checking all feeds')
}

/**
 * Get feed with episode stats
 */
export async function getFeedWithStats(feedId: number): Promise<{
  feed: PodcastFeed
  totalEpisodes: number
  downloadedEpisodes: number
  latestEpisode: Omit<PodcastEpisode, 'fileData'> | null
} | null> {
  const feed = await getPodcastFeedById(feedId)
  if (!feed) return null

  const episodes = await getEpisodesByFeedId(feedId)
  const downloadedCount = episodes.filter(
    (e) => e.downloadStatus === 'complete',
  ).length
  const latestEpisode = await getLatestEpisodeForFeed(feedId)

  return {
    feed,
    totalEpisodes: episodes.length,
    downloadedEpisodes: downloadedCount,
    latestEpisode,
  }
}

/**
 * Get all feeds with stats
 */
export async function getAllFeedsWithStats(): Promise<
  Array<{
    feed: PodcastFeed
    totalEpisodes: number
    downloadedEpisodes: number
  }>
> {
  const feeds = await getAllPodcastFeeds()
  const results = []

  for (const feed of feeds) {
    const episodes = await getEpisodesByFeedId(feed.id)
    const downloadedCount = episodes.filter(
      (e) => e.downloadStatus === 'complete',
    ).length

    results.push({
      feed,
      totalEpisodes: episodes.length,
      downloadedEpisodes: downloadedCount,
    })
  }

  return results
}
