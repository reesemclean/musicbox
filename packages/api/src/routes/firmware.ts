import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { firmware } from '../db/schema.js'

export const firmwareRoutes = new Hono()

// Validation schemas
const versionParamSchema = z.object({
  version: z.string().min(1),
})

// Get latest firmware info
firmwareRoutes.get('/latest.json', async (c) => {
  const [latest] = await db
    .select({
      version: firmware.version,
      sha256: firmware.sha256,
      fileSize: firmware.fileSize,
      createdAt: firmware.createdAt,
    })
    .from(firmware)
    .orderBy(desc(firmware.createdAt))
    .limit(1)

  if (!latest) {
    return c.json({ error: 'No firmware available' }, 404)
  }

  return c.json(latest)
})

// Download firmware by version
firmwareRoutes.get(
  '/:version.bin',
  zValidator('param', versionParamSchema),
  async (c) => {
    const { version } = c.req.valid('param')

    const [fw] = await db
      .select()
      .from(firmware)
      .where(eq(firmware.version, version))
      .limit(1)

    if (!fw) {
      return c.json({ error: 'Firmware version not found' }, 404)
    }

    return new Response(new Uint8Array(fw.fileData), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': fw.fileSize.toString(),
        'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
        'X-SHA256': fw.sha256,
      },
    })
  }
)

// List all firmware versions
firmwareRoutes.get('/', async (c) => {
  const versions = await db
    .select({
      id: firmware.id,
      version: firmware.version,
      sha256: firmware.sha256,
      fileSize: firmware.fileSize,
      createdAt: firmware.createdAt,
    })
    .from(firmware)
    .orderBy(desc(firmware.createdAt))

  return c.json(versions)
})

// Upload new firmware (used by CI/admin)
firmwareRoutes.post(
  '/',
  zValidator('query', z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver format (e.g., 1.0.0)'),
  })),
  async (c) => {
    const { version } = c.req.valid('query')
    const body = await c.req.arrayBuffer()
    const fileData = Buffer.from(body)

    // Calculate SHA256
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileData)
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Check if version already exists
    const [existing] = await db
      .select()
      .from(firmware)
      .where(eq(firmware.version, version))
      .limit(1)

    if (existing) {
      return c.json({ error: 'Version already exists' }, 409)
    }

    const [created] = await db
      .insert(firmware)
      .values({
        version,
        sha256,
        fileData,
        fileSize: fileData.length,
      })
      .returning({
        id: firmware.id,
        version: firmware.version,
        sha256: firmware.sha256,
        fileSize: firmware.fileSize,
        createdAt: firmware.createdAt,
      })

    return c.json(created, 201)
  }
)

// Delete firmware version
firmwareRoutes.delete(
  '/:version',
  zValidator('param', versionParamSchema),
  async (c) => {
    const { version } = c.req.valid('param')

    const [deleted] = await db
      .delete(firmware)
      .where(eq(firmware.version, version))
      .returning()

    if (!deleted) {
      return c.json({ error: 'Firmware version not found' }, 404)
    }

    return c.json({ success: true })
  }
)
