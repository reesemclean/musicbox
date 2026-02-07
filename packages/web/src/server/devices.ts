import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'
import { mqttService, TOPICS } from '../services/mqttService.js'

export const getDevices = createServerFn({ method: 'GET' })
  .handler(async () => {
    const items = await db.select().from(devices)

    // Add playback status to each device
    return items.map((device) => {
      const playbackStatus = mqttService.getPlaybackStatus(device.mac)
      return {
        ...device,
        playback: playbackStatus ? {
          status: playbackStatus.status,
          mediaId: playbackStatus.mediaId,
          mediaTitle: playbackStatus.mediaTitle,
        } : null,
      }
    })
  })

export const getDeviceById = createServerFn({ method: 'GET' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    return device
  })

interface UpdateDeviceData {
  id: number
  name?: string
  status?: 'pending' | 'approved' | 'rejected'
  soundMachineSound?: string | null
  soundMachineVolume?: number | null
  maxVolume?: number | null
}

export const updateDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: UpdateDeviceData) => data)
  .handler(async ({ data }) => {
    const { id, ...updates } = data

    // Get current device state to check for status change
    const [current] = await db.select().from(devices).where(eq(devices.id, id)).limit(1)
    if (!current) throw new Error('Device not found')

    const [updated] = await db
      .update(devices)
      .set(updates)
      .where(eq(devices.id, id))
      .returning()

    if (!updated) throw new Error('Device not found')

    // If status changed to approved, notify the device via MQTT
    if (updates.status === 'approved' && current.status !== 'approved') {
      const macForTopic = updated.mac.replace(/:/g, '')
      mqttService.publish(TOPICS.deviceCommands(macForTopic), {
        command: 'config',
        status: 'approved',
        maxVolume: updated.maxVolume ?? 42,
      })
      console.log(`[Devices] Sent approval to device ${updated.mac}`)
      // Sync cards after approval
      mqttService.syncCardsToDevice(macForTopic)
    }

    // If maxVolume changed, send config update to device
    if (updates.maxVolume !== undefined && current.maxVolume !== updates.maxVolume && updated.status === 'approved') {
      const macForTopic = updated.mac.replace(/:/g, '')
      mqttService.publish(TOPICS.deviceCommands(macForTopic), {
        command: 'config',
        maxVolume: updated.maxVolume ?? 42,
      })
      console.log(`[Devices] Sent maxVolume update to device ${updated.mac}: ${updated.maxVolume ?? 42}`)
    }

    return updated
  })

export const deleteDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [deleted] = await db.delete(devices).where(eq(devices.id, data.id)).returning()
    if (!deleted) throw new Error('Device not found')
    return { success: true }
  })

// Remote control commands
export const pauseDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.pause(macForTopic)
    return { success: true }
  })

export const resumeDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.resume(macForTopic)
    return { success: true }
  })

export const stopDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.stop(macForTopic)
    return { success: true }
  })

export const setDeviceVolume = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number; level: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.setVolume(macForTopic, data.level)
    return { success: true }
  })

export const triggerDeviceUpdate = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.publish(TOPICS.deviceCommands(macForTopic), { command: 'check_update' })
    return { success: true }
  })

export const clearDeviceCache = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.clearCache(macForTopic)
    return { success: true }
  })
