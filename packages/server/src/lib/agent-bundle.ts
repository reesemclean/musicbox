/**
 * Agent bundle utilities
 *
 * The agent is bundled with the server at build time.
 * This module provides access to the bundled agent version and file.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// Agent bundle location (relative to server root)
const AGENT_BUNDLE_PATH = join(process.cwd(), 'data', 'agent', 'agent.tar.gz')
const AGENT_VERSION_PATH = join(process.cwd(), 'data', 'agent', 'version.txt')

let cachedVersion: string | null = null
let cachedChecksum: string | null = null

/**
 * Get the bundled agent version
 */
export function getAgentVersion(): string | null {
  if (cachedVersion) return cachedVersion

  if (!existsSync(AGENT_VERSION_PATH)) {
    return null
  }

  cachedVersion = readFileSync(AGENT_VERSION_PATH, 'utf-8').trim()
  return cachedVersion
}

/**
 * Get the bundled agent checksum (sha256)
 */
export function getAgentChecksum(): string | null {
  if (cachedChecksum) return cachedChecksum

  if (!existsSync(AGENT_BUNDLE_PATH)) {
    return null
  }

  const fileBuffer = readFileSync(AGENT_BUNDLE_PATH)
  cachedChecksum = `sha256:${createHash('sha256').update(fileBuffer).digest('hex')}`
  return cachedChecksum
}

/**
 * Get the bundled agent file path
 */
export function getAgentBundlePath(): string | null {
  if (!existsSync(AGENT_BUNDLE_PATH)) {
    return null
  }
  return AGENT_BUNDLE_PATH
}

/**
 * Get the bundled agent file size in bytes
 */
export function getAgentBundleSize(): number | null {
  if (!existsSync(AGENT_BUNDLE_PATH)) {
    return null
  }
  return statSync(AGENT_BUNDLE_PATH).size
}

/**
 * Check if an agent bundle is available
 */
export function hasAgentBundle(): boolean {
  return existsSync(AGENT_BUNDLE_PATH) && existsSync(AGENT_VERSION_PATH)
}
