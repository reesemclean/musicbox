// Server startup tasks - runs once when this module is first imported
import { seedSystemSounds, seedSoundMachineSounds } from './seedService.js'
import { mqttService } from './mqttService.js'

let initialized = false

export async function ensureInitialized(): Promise<void> {
  if (initialized) return
  initialized = true

  console.log('[Startup] Running initialization tasks...')
  await seedSystemSounds()
  await seedSoundMachineSounds()

  // Connect to MQTT broker for device communication
  try {
    await mqttService.connect()
  } catch (err) {
    console.error('[Startup] MQTT connection failed (will retry on reconnect):', err)
  }

  console.log('[Startup] Initialization complete')
}

// Run on module load (server-side only)
if (typeof window === 'undefined') {
  ensureInitialized().catch(err => {
    console.error('[Startup] Initialization failed:', err)
  })
}
