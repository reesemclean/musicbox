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

export const Route = createFileRoute('/api/firmware/download')({
  server: {
    handlers: {
      GET: async () => {
        if (!existsSync(FIRMWARE_BIN) || !existsSync(FIRMWARE_MANIFEST)) {
          return Response.json({ error: 'No firmware available' }, { status: 404 })
        }

        const manifest: FirmwareManifest = JSON.parse(readFileSync(FIRMWARE_MANIFEST, 'utf-8'))
        const data = readFileSync(FIRMWARE_BIN)
        const sha256 = createHash('sha256').update(data).digest('hex')

        return new Response(data, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': data.length.toString(),
            'Content-Disposition': `attachment; filename="firmware-${manifest.version}.bin"`,
            'X-SHA256': sha256,
            'X-Version': manifest.version,
          },
        })
      },
    },
  },
})
