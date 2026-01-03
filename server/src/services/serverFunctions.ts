import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db'
import {
  cards,
  devices,
  downloadQueue,
  libraryVersion,
  playHistory,
} from '@/db/schema'

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
    return result[0] || null
  })

const CreateCardSchema = z.object({
  nfcId: z.string().min(1),
  contentType: z.enum(['song', 'playlist', 'action']),
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
      contentType: z.enum(['song', 'playlist', 'action']).optional(),
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
// Device Management
// ============================================================================

export const getAllDevices = createServerFn().handler(async () => {
  return db.select().from(devices).orderBy(devices.name)
})

export const registerDevice = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      ipAddress: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const result = await db
      .insert(devices)
      .values({
        name: data.name,
        ipAddress: data.ipAddress,
        libraryVersion: 0,
      })
      .returning()
    return result[0]
  })

export const updateDeviceHeartbeat = createServerFn({ method: 'POST' })
  .inputValidator((data: { deviceId: number }) => data)
  .handler(async ({ data }) => {
    const result = await db
      .update(devices)
      .set({ lastSeen: new Date() })
      .where(eq(devices.id, data.deviceId))
      .returning()
    return result[0]
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
