import { checkAllFeeds, downloadPendingEpisodes, getAllPodcastFeeds } from '@/services/podcastService'

const ONE_HOUR = 60 * 60 * 1000 // 1 hour in milliseconds
const STARTUP_DELAY = 30 * 1000 // 30 seconds

let schedulerStarted = false
let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the podcast scheduler
 * - Runs an initial check 30 seconds after startup
 * - Checks all feeds every hour
 */
export function startPodcastScheduler(): void {
  if (schedulerStarted) {
    console.log('[Podcast Scheduler] Already running')
    return
  }

  schedulerStarted = true
  console.log('[Podcast Scheduler] Starting...')

  // Initial check after startup delay
  setTimeout(async () => {
    console.log('[Podcast Scheduler] Running initial feed check...')
    try {
      await runScheduledCheck()
    } catch (error) {
      console.error('[Podcast Scheduler] Initial check failed:', error)
    }
  }, STARTUP_DELAY)

  // Hourly checks
  intervalId = setInterval(async () => {
    console.log('[Podcast Scheduler] Running hourly feed check...')
    try {
      await runScheduledCheck()
    } catch (error) {
      console.error('[Podcast Scheduler] Hourly check failed:', error)
    }
  }, ONE_HOUR)

  console.log('[Podcast Scheduler] Started - will check feeds hourly')
}

/**
 * Stop the podcast scheduler
 */
export function stopPodcastScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  schedulerStarted = false
  console.log('[Podcast Scheduler] Stopped')
}

/**
 * Run a scheduled check - refresh all feeds and download pending episodes
 */
async function runScheduledCheck(): Promise<void> {
  await checkAllFeeds()

  // Download any pending episodes across all feeds
  const feeds = await getAllPodcastFeeds()
  for (const feed of feeds) {
    try {
      await downloadPendingEpisodes(feed.id)
    } catch (error) {
      console.error(`[Podcast Scheduler] Failed to download episodes for ${feed.title}:`, error)
    }
  }
}

// Auto-start the scheduler when this module is imported
startPodcastScheduler()
