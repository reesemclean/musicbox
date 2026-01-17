/**
 * File Management
 * Ensure config files match desired state.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import type { FileSpec } from './state.js'

/**
 * Calculate SHA256 checksum of file content
 */
function calculateChecksum(content: Buffer | string): string {
  return 'sha256:' + createHash('sha256').update(content).digest('hex')
}

/**
 * Ensure all files match desired state
 * Returns array of changed file paths
 */
export async function ensureFiles(
  files: Record<string, FileSpec>
): Promise<string[]> {
  const changed: string[] = []

  for (const [path, spec] of Object.entries(files)) {
    let currentChecksum: string | null = null

    if (existsSync(path)) {
      const content = readFileSync(path)
      currentChecksum = calculateChecksum(content)
    }

    if (currentChecksum !== spec.checksum) {
      console.log(`Updating file: ${path}`)

      // Ensure directory exists
      const dir = dirname(path)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(path, spec.content, { mode: 0o644 })
      changed.push(path)
    }
  }

  return changed
}
