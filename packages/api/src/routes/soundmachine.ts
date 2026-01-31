import { Hono } from 'hono'
import { describeRoute, resolver } from 'hono-openapi'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices, media } from '../db/schema.js'

export const soundmachineRoutes = new Hono()

// Schemas
const macParamSchema = z.object({
  mac: z.string().min(1),
})

const configResponseSchema = z.object({
  soundId: z.number().nullable(),
  soundName: z.string().nullable(),
  streamUrl: z.string().nullable(),
})

const soundSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number().nullable(),
})

const errorSchema = z.object({
  error: z.string(),
})

// Get sound machine config for a device (by MAC address - used by ESP32)
soundmachineRoutes.get(
  '/config/:mac',
  describeRoute({
    tags: ['Sound Machine'],
    summary: 'Get sound machine config for device',
    description: 'Returns the configured sound machine sound for a device',
    responses: {
      200: {
        description: 'Sound machine configuration',
        content: { 'application/json': { schema: resolver(configResponseSchema) } },
      },
      404: {
        description: 'Device not found',
        content: { 'application/json': { schema: resolver(errorSchema) } },
      },
    },
  }),
  sValidator('param', macParamSchema),
  async (c) => {
    const { mac } = c.req.valid('param')

    // Convert MAC without colons to with colons for DB lookup
    const macWithColons = mac.includes(':') ? mac : mac.match(/.{2}/g)?.join(':') || mac

    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.mac, macWithColons))
      .limit(1)

    if (!device) {
      return c.json({ error: 'Device not found' }, 404)
    }

    // If no sound configured, return nulls
    if (!device.soundMachineSound) {
      return c.json({
        soundId: null,
        soundName: null,
        streamUrl: null,
      })
    }

    // soundMachineSound stores the media ID as string
    const soundId = parseInt(device.soundMachineSound, 10)
    if (isNaN(soundId)) {
      return c.json({
        soundId: null,
        soundName: null,
        streamUrl: null,
      })
    }

    // Look up the sound
    const [sound] = await db
      .select()
      .from(media)
      .where(eq(media.id, soundId))
      .limit(1)

    if (!sound) {
      return c.json({
        soundId: null,
        soundName: null,
        streamUrl: null,
      })
    }

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001'

    return c.json({
      soundId: sound.id,
      soundName: sound.title,
      streamUrl: `${baseUrl}/api/media/stream/${sound.id}`,
    })
  }
)

// List all available sound machine sounds
soundmachineRoutes.get(
  '/sounds',
  describeRoute({
    tags: ['Sound Machine'],
    summary: 'List sound machine sounds',
    description: 'Returns all available sound machine sounds',
    responses: {
      200: {
        description: 'List of sounds',
        content: { 'application/json': { schema: resolver(z.array(soundSchema)) } },
      },
    },
  }),
  async (c) => {
    const sounds = await db
      .select({
        id: media.id,
        title: media.title,
        duration: media.duration,
      })
      .from(media)
      .where(eq(media.type, 'soundmachine'))

    return c.json(sounds)
  }
)
