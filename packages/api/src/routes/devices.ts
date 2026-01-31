import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'
import { mqttService, TOPICS } from '../services/mqttService.js'

export const deviceRoutes = new Hono()

// Schemas
const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
})

const deviceStatusSchema = z.enum(['pending', 'approved', 'rejected'])

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
  createdAt: z.string().datetime(),
})

const updateDeviceSchema = z.object({
  name: z.string().optional(),
  status: deviceStatusSchema.optional(),
  soundMachineSound: z.string().nullable().optional(),
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
    return c.json(items)
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
