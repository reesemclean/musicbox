import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'
import { mqttService, TOPICS } from '../services/mqttService.js'
import { getFirmwareInfo } from './firmware.js'

export const getDevices = createServerFn({ method: 'GET' })
  .handler(async () => {
    const items = await db.select().from(devices)

    // Add playback status to each device
    return items.map((device) => {
      const playbackStatus = mqttService.getPlaybackStatus(device.mac)
      return {
        ...device,
        // The broker's view, from the retained status topic. Undefined when
        // nothing has been heard, which the UI falls back from.
        online: mqttService.isDeviceOnline(device.mac),
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

    const macForTopic = updated.mac.replace(/:/g, '')

    // If status changed to approved, notify the device via MQTT. Nothing else
    // needs pushing — cards are resolved per-scan against the database.
    if (updates.status === 'approved' && current.status !== 'approved') {
      mqttService.publish(TOPICS.deviceCommands(macForTopic), {
        command: 'config',
        status: 'approved',
        maxVolume: updated.maxVolume ?? 42,
      })
      console.log(`[Devices] Sent approval to device ${updated.mac}`)
      await mqttService.pushSoundMachineConfig(updated.mac)
    }

    // If maxVolume changed, send config update to device
    if (updates.maxVolume !== undefined && current.maxVolume !== updates.maxVolume && updated.status === 'approved') {
      mqttService.publish(TOPICS.deviceCommands(macForTopic), {
        command: 'config',
        maxVolume: updated.maxVolume ?? 42,
      })
      console.log(`[Devices] Sent maxVolume update to device ${updated.mac}: ${updated.maxVolume ?? 42}`)
    }

    // The device stores its sound machine configuration locally so a
    // long-press works without asking the server — and keeps working when the
    // server is unreachable. That copy is only correct if changes are pushed.
    const soundChanged =
      (updates.soundMachineSound !== undefined &&
        updates.soundMachineSound !== current.soundMachineSound) ||
      (updates.soundMachineVolume !== undefined &&
        updates.soundMachineVolume !== current.soundMachineVolume)

    if (soundChanged && updated.status === 'approved') {
      await mqttService.pushSoundMachineConfig(updated.mac)
      console.log(`[Devices] Pushed sound machine config to ${updated.mac}`)
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

    const firmware = await getFirmwareInfo()
    if (!firmware) throw new Error('No firmware available')

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'
    const downloadUrl = `${baseUrl}/api/firmware/download`
    const macForTopic = device.mac.replace(/:/g, '')
    mqttService.triggerOta(macForTopic, downloadUrl, firmware.version, firmware.sha256)
    return { success: true }
  })

/**
 * Re-push the device's sound machine configuration.
 *
 * Replaces the old "clear cache" action: devices no longer hold a media or
 * card cache, so the only local state worth refreshing by hand is this.
 */
export const resyncDevice = createServerFn({ method: 'POST' })
  .inputValidator((data: { id: number }) => data)
  .handler(async ({ data }) => {
    const [device] = await db.select().from(devices).where(eq(devices.id, data.id)).limit(1)
    if (!device) throw new Error('Device not found')
    if (device.status !== 'approved') throw new Error('Device not approved')

    await mqttService.pushSoundMachineConfig(device.mac)
    return { success: true }
  })
