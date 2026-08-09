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
 * This is the deliberate answer, not a stopgap awaiting a framework feature.
 * Start's `./server-entry` export looks like the obvious replacement and is not
 * one: a `src/server.ts` built on `createServerEntry` is evaluated on the first
 * request, not at boot, so moving startup there reintroduces exactly the lazy
 * behaviour this file prevents. Measured on 1.168, not assumed — with the plugin
 * removed, the log was still empty eight seconds after the server began
 * listening, and one request produced the whole startup sequence. `createStart`
 * is not an alternative either; it offers middleware, serialization adapters and
 * SSR options, nothing process-scoped.
 *
 * If you are tempted to replace this with an import whose side effects run
 * earlier in the module graph, don't — that rebuilds the guarantee out of
 * import-order luck. Whatever replaces this has to prove the same property:
 * MQTT connected and subscribed before any HTTP traffic.
 */
export default function startupPlugin(_nitroApp: NitroApp) {
  // Not awaited: Nitro should finish booting and start listening regardless of
  // how long migrations, seeding, or a broker connect attempt take.
  ensureInitialized().catch((err) => {
    console.error('[Startup] Initialization failed:', err)
  })
}
