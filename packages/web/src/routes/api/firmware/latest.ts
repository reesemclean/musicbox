import { createFileRoute } from '@tanstack/react-router'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const FIRMWARE_DIR = join(process.cwd(), 'firmware')
const FIRMWARE_BIN = join(FIRMWARE_DIR, 'firmware.bin')
const FIRMWARE_MANIFEST = join(FIRMWARE_DIR, 'manifest.json')

interface FirmwareManifest {
  version: string
}

// Cache firmware info
let firmwareInfo: {
  version: string
  sha256: string
  fileSize: number
} | null = null

function loadFirmwareInfo() {
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
  }
}

// Load on module init
firmwareInfo = loadFirmwareInfo()

export const Route = createFileRoute('/api/firmware/latest')({
  server: {
    handlers: {
      GET: async () => {
        if (!firmwareInfo) {
          // Try to reload in case firmware was added
          firmwareInfo = loadFirmwareInfo()
        }

        if (!firmwareInfo) {
          return Response.json({ error: 'No firmware available' }, { status: 404 })
        }

        return Response.json({
          version: firmwareInfo.version,
          sha256: firmwareInfo.sha256,
          fileSize: firmwareInfo.fileSize,
        })
      },
    },
  },
})
