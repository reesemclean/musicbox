import { createServerFn } from '@tanstack/react-start'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const FIRMWARE_DIR = join(process.cwd(), 'firmware')
const FIRMWARE_BIN = join(FIRMWARE_DIR, 'firmware.bin')
const FIRMWARE_MANIFEST = join(FIRMWARE_DIR, 'manifest.json')

interface FirmwareManifest {
  version: string
}

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

export const getFirmwareInfo = createServerFn({ method: 'GET' })
  .handler(async () => {
    const info = loadFirmwareInfo()
    if (!info) {
      return null
    }
    return info
  })
