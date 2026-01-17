import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import * as devicesService from './devicesService.js'
import * as ansibleService from './ansibleService.js'
import * as podcastService from './podcastService.js'
import { db } from '@/db'
import { cards, downloadQueue, libraryVersion, playHistory } from '@/db/schema'
import { nfcQueue } from '@/lib/nfc-queue'

// ============================================================================
// NFC Scanning
// ============================================================================

export const startNFCScanSession = createServerFn({ method: 'POST' }).handler(
  () => {
    const sessionId = nfcQueue.startSession()
    return { sessionId }
  },
)

export const stopNFCScanSession = createServerFn({ method: 'POST' })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(({ data }) => {
    nfcQueue.endSession(data.sessionId)
    return { success: true }
  })

export const pollNFCScans = createServerFn({ method: 'GET' })
  .inputValidator((data: { sessionId: string }) => data)
  .handler(({ data }) => {
    const scans = nfcQueue.getRecentScans(data.sessionId)
    return { scans }
  })

// ============================================================================
// Card Management
// ============================================================================

export const getAllCards = createServerFn().handler(async () => {
  return db.select().from(cards)
})

export const getCard = createServerFn({ method: 'GET' })
  .inputValidator((data: { nfcId: string }) => data)
  .handler(async ({ data }) => {
    const result = await db
      .select()
      .from(cards)
      .where(eq(cards.nfcId, data.nfcId))
    return result.length > 0 ? result[0] : null
  })

const CreateCardSchema = z.object({
  nfcId: z.string().min(1),
  contentType: z.enum(['song', 'playlist', 'action', 'podcast']),
  contentPath: z.string().optional(),
  action: z.enum(['play', 'pause', 'next', 'previous', 'stop']).optional(),
})

export const createCard = createServerFn({ method: 'POST' })
  .inputValidator(CreateCardSchema)
  .handler(async ({ data }) => {
    const result = await db
      .insert(cards)
      .values({
        nfcId: data.nfcId,
        contentType: data.contentType,
        contentPath: data.contentPath,
        action: data.action,
      })
      .returning()
    return result[0]
  })

export const updateCard = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      nfcId: z.string(),
      contentType: z.enum(['song', 'playlist', 'action', 'podcast']).optional(),
      contentPath: z.string().optional(),
      action: z.enum(['play', 'pause', 'next', 'previous', 'stop']).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { nfcId, ...updates } = data
    const result = await db
      .update(cards)
      .set(updates)
      .where(eq(cards.nfcId, nfcId))
      .returning()
    return result[0]
  })

export const deleteCard = createServerFn({ method: 'POST' })
  .inputValidator((data: { nfcId: string }) => data)
  .handler(async ({ data }) => {
    await db.delete(cards).where(eq(cards.nfcId, data.nfcId))
    return { success: true }
  })

// ============================================================================
// Library Version & Sync
// ============================================================================

export const getCurrentLibraryVersion = createServerFn().handler(async () => {
  const result = await db
    .select()
    .from(libraryVersion)
    .orderBy(desc(libraryVersion.version))
    .limit(1)
  return result[0]?.version || 0
})

export const incrementLibraryVersion = createServerFn({ method: 'POST' })
  .inputValidator((data: { changeDescription?: string }) => data)
  .handler(async ({ data }) => {
    const currentVersion = await getCurrentLibraryVersion()
    const newVersion = currentVersion + 1

    const result = await db
      .insert(libraryVersion)
      .values({
        version: newVersion,
        changeDescription: data.changeDescription,
      })
      .returning()

    return result[0]
  })

// ============================================================================
// Play History
// ============================================================================

export const recordPlay = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      deviceId: z.number(),
      songPath: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await db
      .insert(playHistory)
      .values({
        deviceId: data.deviceId,
        songPath: data.songPath,
        playedAt: new Date(),
      })
      .returning()
    return result[0]
  })

export const getPlayHistory = createServerFn({ method: 'GET' })
  .inputValidator(
    z
      .object({
        deviceId: z.number().optional(),
        limit: z.number().optional().default(100),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    let query = db.select().from(playHistory)

    if (data?.deviceId) {
      query = query.where(eq(playHistory.deviceId, data.deviceId)) as any
    }

    return query.orderBy(desc(playHistory.playedAt)).limit(data?.limit || 100)
  })

// ============================================================================
// Download Queue
// ============================================================================

export const getDownloadQueue = createServerFn().handler(async () => {
  return db.select().from(downloadQueue).orderBy(downloadQueue.addedAt)
})

export const addToDownloadQueue = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      videoId: z.string(),
      title: z.string(),
      artist: z.string().optional(),
      album: z.string().optional(),
      targetPath: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await db
      .insert(downloadQueue)
      .values({
        videoId: data.videoId,
        title: data.title,
        artist: data.artist,
        album: data.album,
        targetPath: data.targetPath,
        status: 'pending',
        progress: 0,
      })
      .returning()
    return result[0]
  })

export const updateDownloadStatus = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      videoId: z.string(),
      status: z.enum(['pending', 'downloading', 'complete', 'failed']),
      progress: z.number().min(0).max(100).optional(),
      error: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const updates: any = {
      status: data.status,
      progress: data.progress ?? 0,
      error: data.error,
    }

    if (data.status === 'complete') {
      updates.completedAt = new Date()
    }

    const result = await db
      .update(downloadQueue)
      .set(updates)
      .where(eq(downloadQueue.videoId, data.videoId))
      .returning()
    return result[0]
  })

// ============================================================================
// Device Management
// ============================================================================

/**
 * Get all devices
 */
export const getDevices = createServerFn().handler(async () => {
  return await devicesService.getAllDevices()
})

/**
 * Send command to device (HTTP proxy)
 */
export const sendDeviceCommand = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      deviceId: z.number(),
      command: z.enum(['play', 'pause', 'next', 'previous', 'stop']),
      nfcId: z.string().optional(), // For scan command
    }),
  )
  .handler(async ({ data }) => {
    const device = await devicesService.getDeviceById(data.deviceId)

    if (!device || !device.ipAddress) {
      throw new Error('Device not found or offline')
    }

    const playerUrl = `http://${device.ipAddress}:${device.httpPort}`

    let endpoint: string
    let body: string | undefined = undefined

    if (data.nfcId) {
      endpoint = '/scan'
      body = JSON.stringify({ nfcId: data.nfcId })
    } else {
      endpoint = `/${data.command}`
    }

    const response = await fetch(`${playerUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      throw new Error(`Player returned ${response.status}`)
    }

    return { success: true }
  })

/**
 * Get all pending devices waiting for approval
 */
export const getPendingDevices = createServerFn().handler(async () => {
  return await devicesService.getPendingDevices()
})

/**
 * Approve a pending device
 */
export const approveDevice = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      deviceId: z.number(),
      name: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const device = await devicesService.approveDevice(data.deviceId, data.name)

    if (!device) {
      throw new Error('Device not found or not pending')
    }

    return { device }
  })

/**
 * Reject a pending device
 */
export const rejectDevice = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      deviceId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const device = await devicesService.rejectDevice(data.deviceId)

    if (!device) {
      throw new Error('Device not found or not pending')
    }

    return { device }
  })

// ============================================================================
// Ansible Deployment
// ============================================================================

/**
 * Trigger Ansible deployment to devices
 */
export const triggerDeployment = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      deviceId: z.number().optional(),
      playbook: z
        .enum(['site', 'deploy-player', 'sync-config'])
        .default('site'),
    }),
  )
  .handler(async ({ data }) => {
    const runId = await ansibleService.runPlaybook(data.playbook, data.deviceId)
    return { runId, success: true }
  })

/**
 * Get deployment run history
 */
export const getDeploymentRuns = createServerFn()
  .inputValidator(
    z
      .object({
        limit: z.number().optional().default(50),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const runs = await ansibleService.getDeploymentRuns(data?.limit || 50)
    return { runs }
  })

/**
 * Get a specific deployment run with output
 */
export const getDeploymentRun = createServerFn()
  .inputValidator(
    z.object({
      runId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const run = await ansibleService.getDeploymentRun(data.runId)
    if (!run) {
      throw new Error('Deployment run not found')
    }
    return { run }
  })

/**
 * Get server's SSH public key for device registration
 */
export const getSSHPublicKey = createServerFn().handler(() => {
  const publicKey = ansibleService.getServerSSHPublicKey()
  return { publicKey }
})

/**
 * Get devices ready for deployment
 */
export const getDeployableDevices = createServerFn().handler(async () => {
  const devices = await ansibleService.getDeployableDevices()
  return { devices }
})

// ============================================================================
// Podcast Management
// ============================================================================

/**
 * Add a new podcast feed by URL
 */
export const addPodcastFeed = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      feedUrl: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await podcastService.addPodcastFeed(data.feedUrl)
    return result
  })

/**
 * Get all podcast feeds with stats
 */
export const getAllPodcastFeeds = createServerFn().handler(async () => {
  const feeds = await podcastService.getAllFeedsWithStats()
  return feeds
})

/**
 * Get a single podcast feed with details
 */
export const getPodcastFeed = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      feedId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await podcastService.getFeedWithStats(data.feedId)
    if (!result) {
      throw new Error('Podcast feed not found')
    }
    return result
  })

/**
 * Get episodes for a podcast feed
 */
export const getPodcastEpisodes = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      feedId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const episodes = await podcastService.getEpisodesByFeedId(data.feedId)
    // Return episodes without file data for the list view
    return episodes.map((ep) => ({
      id: ep.id,
      feedId: ep.feedId,
      guid: ep.guid,
      title: ep.title,
      description: ep.description,
      duration: ep.duration,
      publishedAt: ep.publishedAt,
      mimeType: ep.mimeType,
      fileSize: ep.fileSize,
      sourceUrl: ep.sourceUrl,
      downloadStatus: ep.downloadStatus,
      downloadError: ep.downloadError,
      listenedAt: ep.listenedAt,
      createdAt: ep.createdAt,
    }))
  })

/**
 * Delete a podcast feed
 */
export const deletePodcastFeed = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      feedId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    await podcastService.deletePodcastFeed(data.feedId)
    return { success: true }
  })

/**
 * Manually refresh a podcast feed
 */
export const refreshPodcastFeed = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      feedId: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await podcastService.refreshFeed(data.feedId)
    // Download any new episodes
    if (result.newEpisodes > 0) {
      await podcastService.downloadPendingEpisodes(data.feedId)
    }
    return result
  })

/**
 * Update podcast feed settings
 */
export const updatePodcastFeed = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      feedId: z.number(),
      episodesToKeep: z.number().min(1).max(50).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { feedId, ...updates } = data
    const feed = await podcastService.updatePodcastFeed(feedId, updates)
    if (!feed) {
      throw new Error('Podcast feed not found')
    }
    return { feed }
  })
