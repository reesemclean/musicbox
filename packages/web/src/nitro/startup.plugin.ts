import type { NitroApp } from 'nitro/types'
import { ensureInitialized } from '../services/startup.js'

/**
 * Run server startup when the process starts, not when the first request
 * arrives.
 *
 * Startup lives in a module that is only pulled in by server functions, so
 * without this it is lazy: migrations, seeding, and — critically — the MQTT
 * connection all wait for someone to open the web UI. A device that boots
 * before any human does would find nothing subscribed to its topics, so its
 * registration would be missed and card scans would go unanswered.
 *
 * That matters more than it used to. Devices no longer hold a local card or
 * media cache, so an unreachable server means a card scan produces nothing at
 * all. The server has to be listening before the first card is scanned.
 *
 * In containers a healthcheck request happened to paper over this by hitting
 * the server ~10s after start; relying on that is accidental, and it does
 * nothing for anyone running the server outside Docker.
 *
 * This plugin is a workaround for the framework version in use. Newer TanStack
 * Start releases provide a first-class server startup hook — see backlog M.1,
 * which should remove the need for this file.
 */
export default function startupPlugin(_nitroApp: NitroApp) {
  // Not awaited: Nitro should finish booting and start listening regardless of
  // how long migrations, seeding, or a broker connect attempt take.
  ensureInitialized().catch((err) => {
    console.error('[Startup] Initialization failed:', err)
  })
}
