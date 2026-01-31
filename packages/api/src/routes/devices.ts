import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'
import { mqttService, TOPICS, type PlaybackStatus } from '../services/mqttService.js'

export const deviceRoutes = new Hono()

// Schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const deviceStatusSchema = z.enum(['pending', 'approved', 'rejected'])

const playbackStatusSchema = z.object({
  status: z.enum(['playing', 'paused', 'stopped', 'finished']),
  mediaId: z.number().optional(),
  mediaTitle: z.string().optional(),
}).nullable()

const deviceSchema = z.object({
  id: z.number(),
  mac: z.string(),
  name: z.string().nullable(),
  secret: z.string(),
  status: deviceStatusSchema,
  firmwareVersion: z.string().nullable(),
  lastSeen: z.string().datetime().nullable(),
  lastIp: z.string().nullable(),
  soundMachineSound: z.string().nullable(),
  soundMachineVolume: z.number().nullable(),
  createdAt: z.string().datetime(),
  playback: playbackStatusSchema.optional(),
})

const updateDeviceSchema = z.object({
  name: z.string().optional(),
  status: deviceStatusSchema.optional(),
  soundMachineSound: z.string().nullable().optional(),
  soundMachineVolume: z.number().min(0).max(21).nullable().optional(),
})

const errorSchema = z.object({
  error: z.string(),
})

const successSchema = z.object({
  success: z.boolean(),
})

// List all devices
deviceRoutes.get(
  '/',
  describeRoute({
    tags: ['Devices'],
    summary: 'List all devices',
    responses: {
      200: {
        description: 'List of devices',
        content: { 'application/json': { schema: resolver(z.array(deviceSchema)) } },
      },
    },
  }),
  async (c) => {
    const items = await db.select().from(devices)

    // Add playback status to each device
    const devicesWithPlayback = items.map((device) => {
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

    return c.json(devicesWithPlayback)
  }
)

// Get single device
deviceRoutes.get(
  '/:id',
  describeRoute({
    tags: ['Devices'],
    summary: 'Get device by ID',
    responses: {
      200: {
        description: 'Device',
        content: { 'application/json': { schema: resolver(deviceSchema) } },
      },
      404: {
        description: 'Device not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1)

    if (!device) {
      return c.json({ error: 'Device not found' }, 404)
    }

    return c.json(device)
  }
)

// Update device
deviceRoutes.patch(
  '/:id',
  describeRoute({
    tags: ['Devices'],
    summary: 'Update device',
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: resolver(updateDeviceSchema) },
      },
    },
    responses: {
      200: {
        description: 'Updated device',
        content: { 'application/json': { schema: resolver(deviceSchema) } },
      },
      404: {
        description: 'Device not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', updateDeviceSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')

    // Get current device state to check for status change
    const [current] = await db.select().from(devices).where(eq(devices.id, id)).limit(1)
    if (!current) {
      return c.json({ error: 'Device not found' }, 404)
    }

    const [updated] = await db
      .update(devices)
      .set(data)
      .where(eq(devices.id, id))
      .returning()

    if (!updated) {
      return c.json({ error: 'Device not found' }, 404)
    }

    // If status changed to approved, notify the device via MQTT
    if (data.status === 'approved' && current.status !== 'approved') {
      const macForTopic = updated.mac.replace(/:/g, '')
      mqttService.publish(TOPICS.deviceCommands(macForTopic), {
        command: 'config',
        status: 'approved',
      })
      console.log(`[Devices] Sent approval to device ${updated.mac}`)
    }

    return c.json(updated)
  }
)

// Delete device
deviceRoutes.delete(
  '/:id',
  describeRoute({
    tags: ['Devices'],
    summary: 'Delete device',
    responses: {
      200: {
        description: 'Success',
        content: { 'application/json': { schema: resolver(successSchema) } },
      },
      404: {
        description: 'Device not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const [deleted] = await db.delete(devices).where(eq(devices.id, id)).returning()

    if (!deleted) {
      return c.json({ error: 'Device not found' }, 404)
    }

    return c.json({ success: true })
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// Remote Control Endpoints
// ─────────────────────────────────────────────────────────────────────────────

const volumeSchema = z.object({
  level: z.number().min(0).max(21),
})

// Helper to get device and validate it's approved
async function getApprovedDevice(id: number) {
  const [device] = await db.select().from(devices).where(eq(devices.id, id)).limit(1)
  if (!device) return { error: 'Device not found', status: 404 as const }
  if (device.status !== 'approved') return { error: 'Device not approved', status: 400 as const }
  return { device }
}

// Pause playback
deviceRoutes.post(
  '/:id/pause',
  describeRoute({
    tags: ['Devices'],
    summary: 'Pause device playback',
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: resolver(successSchema) } } },
      400: { description: 'Device not approved', content: { 'application/json': { schema: resolver(errorSchema) } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: resolver(errorSchema) } } },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await getApprovedDevice(id)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    const macForTopic = result.device.mac.replace(/:/g, '')
    mqttService.pause(macForTopic)
    return c.json({ success: true })
  }
)

// Resume playback
deviceRoutes.post(
  '/:id/resume',
  describeRoute({
    tags: ['Devices'],
    summary: 'Resume device playback',
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: resolver(successSchema) } } },
      400: { description: 'Device not approved', content: { 'application/json': { schema: resolver(errorSchema) } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: resolver(errorSchema) } } },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await getApprovedDevice(id)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    const macForTopic = result.device.mac.replace(/:/g, '')
    mqttService.resume(macForTopic)
    return c.json({ success: true })
  }
)

// Stop playback
deviceRoutes.post(
  '/:id/stop',
  describeRoute({
    tags: ['Devices'],
    summary: 'Stop device playback',
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: resolver(successSchema) } } },
      400: { description: 'Device not approved', content: { 'application/json': { schema: resolver(errorSchema) } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: resolver(errorSchema) } } },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await getApprovedDevice(id)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    const macForTopic = result.device.mac.replace(/:/g, '')
    mqttService.stop(macForTopic)
    return c.json({ success: true })
  }
)

// Set volume
deviceRoutes.post(
  '/:id/volume',
  describeRoute({
    tags: ['Devices'],
    summary: 'Set device volume',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: resolver(volumeSchema) } },
    },
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: resolver(successSchema) } } },
      400: { description: 'Device not approved', content: { 'application/json': { schema: resolver(errorSchema) } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: resolver(errorSchema) } } },
    },
  }),
  sValidator('param', idParamSchema),
  sValidator('json', volumeSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { level } = c.req.valid('json')
    const result = await getApprovedDevice(id)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    const macForTopic = result.device.mac.replace(/:/g, '')
    mqttService.setVolume(macForTopic, level)
    return c.json({ success: true })
  }
)

// Trigger OTA update
deviceRoutes.post(
  '/:id/update',
  describeRoute({
    tags: ['Devices'],
    summary: 'Trigger OTA update on device',
    description: 'Sends OTA update command to the device with the latest firmware',
    responses: {
      200: { description: 'Update command sent', content: { 'application/json': { schema: resolver(successSchema) } } },
      400: { description: 'Device not approved or no firmware available', content: { 'application/json': { schema: resolver(errorSchema) } } },
      404: { description: 'Device not found', content: { 'application/json': { schema: resolver(errorSchema) } } },
    },
  }),
  sValidator('param', idParamSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const result = await getApprovedDevice(id)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    // Get firmware info
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'

    // Fetch firmware info from our own API
    const firmwareResponse = await fetch(`${baseUrl}/api/firmware/latest`)
    if (!firmwareResponse.ok) {
      return c.json({ error: 'No firmware available' }, 400)
    }

    const firmware = await firmwareResponse.json() as { version: string; sha256: string; fileSize: number }

    const macForTopic = result.device.mac.replace(/:/g, '')
    mqttService.triggerOta(macForTopic, `${baseUrl}/api/firmware/download`, firmware.version, firmware.sha256)

    console.log(`[Devices] Triggered OTA update for ${result.device.mac} to version ${firmware.version}`)
    return c.json({ success: true })
  }
)
