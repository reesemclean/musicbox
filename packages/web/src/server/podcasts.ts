import { createServerFn } from '@tanstack/react-start'
import {
  addPodcastFeed,
  getPodcastFeeds,
  getPodcastFeed,
  deletePodcastFeed,
  updatePodcastFeed,
  refreshFeed,
  refreshAllFeeds,
} from '../services/podcastService.js'

export const getFeeds = createServerFn({ method: 'GET' })
  .handler(async () => {
    return getPodcastFeeds()
  })

export const getFeedById = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    return getPodcastFeed(data.id)
  })

export const addFeed = createServerFn({ method: 'POST' })
  .inputValidator((data: { feedUrl: string; retentionCount?: number }) => data)
  .handler(async ({ data }) => {
    return addPodcastFeed(data.feedUrl, data.retentionCount ?? 3)
  })

export const updateFeed = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; name?: string; retentionCount?: number }) => data)
  .handler(async ({ data }) => {
    const { id, ...updates } = data
    return updatePodcastFeed(id, updates)
  })

export const deleteFeed = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await deletePodcastFeed(data.id)
    return { success: true }
  })

export const refreshPodcastFeed = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    await refreshFeed(data.id)
    return { success: true }
  })

export const refreshAllPodcastFeeds = createServerFn({ method: 'POST' })
  .handler(async () => {
    return refreshAllFeeds()
  })
