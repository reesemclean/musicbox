import { db } from '../db/index.js'
import { podcastFeeds } from '../db/schema.js'
import { refreshAllFeeds } from './podcastService.js'

/**
 * How often subscribed feeds are checked for new episodes.
 *
 * Podcasts publish on the order of days, so this only needs to be frequent
 * enough that a card scanned in the morning gets that morning's episode.
 * Six hours gives that without hammering anyone's feed host.
 */
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Delay before the first run, so a refresh doesn't compete with migrations,
 * seeding, MQTT connect, and the media backfill for a freshly-started server.
 */
const INITIAL_DELAY_MS = 60 * 1000

let timer: NodeJS.Timeout | null = null
let running = false

/**
 * Keep subscribed podcast feeds current.
 *
 * A subscription whose content only updates when somebody opens the UI and
 * clicks refresh isn't really a subscription — a podcast card would play
 * whatever episode happened to be current the last time a human looked.
 *
 * Set MUSICBOX_SKIP_PODCAST_REFRESH=1 to disable.
 */
export function startPodcastRefreshSchedule(): void {
  if (process.env.MUSICBOX_SKIP_PODCAST_REFRESH === '1') {
    console.log('[Podcasts] Scheduled refresh disabled (MUSICBOX_SKIP_PODCAST_REFRESH=1)')
    return
  }

  if (timer) return

  const tick = async () => {
    // Refreshing downloads episodes, so a slow run must not overlap the next
    // tick and pile up concurrent downloads of the same feed.
    if (running) {
      console.log('[Podcasts] Previous refresh still running, skipping this tick')
      return
    }

    try {
      running = true

      // Cheap guard: most installs have no feeds, and refreshAllFeeds would
      // otherwise log a no-op result every six hours forever.
      const feeds = await db.select({ id: podcastFeeds.id }).from(podcastFeeds).limit(1)
      if (feeds.length === 0) return

      const result = await refreshAllFeeds()
      console.log(
        `[Podcasts] Scheduled refresh: ${result.succeeded}/${result.total} feed(s) ok` +
          (result.failed > 0 ? `, ${result.failed} failed` : '')
      )
    } catch (err) {
      // Never let a failed refresh kill the interval — a feed host being down
      // shouldn't mean no more refreshes until the next restart.
      console.error('[Podcasts] Scheduled refresh failed:', err)
    } finally {
      running = false
    }
  }

  timer = setTimeout(() => {
    void tick()
    timer = setInterval(() => void tick(), REFRESH_INTERVAL_MS)
    // Don't hold the process open on this timer alone.
    timer.unref?.()
  }, INITIAL_DELAY_MS)

  timer.unref?.()

  console.log(
    `[Podcasts] Scheduled refresh every ${REFRESH_INTERVAL_MS / 3_600_000}h ` +
      `(first run in ${INITIAL_DELAY_MS / 1000}s)`
  )
}

/** Stop the schedule. Exposed for tests and clean shutdown. */
export function stopPodcastRefreshSchedule(): void {
  if (!timer) return
  clearTimeout(timer)
  clearInterval(timer)
  timer = null
}
