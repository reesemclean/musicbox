import { Hono } from 'hono'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const firmwareRoutes = new Hono()

const __dirname = dirname(fileURLToPath(import.meta.url))

// Firmware is expected at packages/api/firmware/firmware.bin with a manifest
const FIRMWARE_DIR = join(__dirname, '../../firmware')
const FIRMWARE_BIN = join(FIRMWARE_DIR, 'firmware.bin')
const FIRMWARE_MANIFEST = join(FIRMWARE_DIR, 'manifest.json')

interface FirmwareManifest {
  version: string
}

// Cache firmware info at startup
let firmwareInfo: {
  version: string
  sha256: string
  fileSize: number
  data: Buffer
} | null = null

function loadFirmware() {
  if (!existsSync(FIRMWARE_BIN) || !existsSync(FIRMWARE_MANIFEST)) {
    return null
  }

  const manifest: FirmwareManifest = JSON.parse(readFileSync(FIRMWARE_MANIFEST, 'utf-8'))
  const data = readFileSync(FIRMWARE_BIN)
  const sha256 = createHash('sha256').update(data).digest('hex')

  return {
    version: manifest.version,
    sha256,
    fileSize: data.length,
    data,
  }
}

// Load on module init
firmwareInfo = loadFirmware()

// Get current firmware info
firmwareRoutes.get('/latest.json', (c) => {
  if (!firmwareInfo) {
    return c.json({ error: 'No firmware available' }, 404)
  }

  return c.json({
    version: firmwareInfo.version,
    sha256: firmwareInfo.sha256,
    fileSize: firmwareInfo.fileSize,
  })
})

// Download firmware binary
firmwareRoutes.get('/firmware.bin', (c) => {
  if (!firmwareInfo) {
    return c.json({ error: 'No firmware available' }, 404)
  }

  return new Response(new Uint8Array(firmwareInfo.data), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': firmwareInfo.fileSize.toString(),
      'Content-Disposition': `attachment; filename="firmware-${firmwareInfo.version}.bin"`,
      'X-SHA256': firmwareInfo.sha256,
      'X-Version': firmwareInfo.version,
    },
  })
})
