/**
 * Player bundle utilities
 *
 * The player Go binary is built and bundled with the server at build time.
 * This module provides access to the bundled player version and checksum.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

// Binary locations - kept outside /data so it's not overridden by volume mounts
const PLAYER_BUNDLE_DIR = join(process.cwd(), 'player-bundle')
const PLAYER_BINARY_PATH = join(PLAYER_BUNDLE_DIR, 'musicbox-player')
const PLAYER_VERSION_PATH = join(PLAYER_BUNDLE_DIR, 'version.txt')

let cachedVersion: string | null = null
let cachedChecksum: string | null = null

/**
 * Get the bundled player version
 */
export function getPlayerVersion(): string | null {
  if (cachedVersion) return cachedVersion

  if (!existsSync(PLAYER_VERSION_PATH)) {
    return null
  }

  cachedVersion = readFileSync(PLAYER_VERSION_PATH, 'utf-8').trim()
  return cachedVersion
}

/**
 * Get the bundled player checksum (sha256)
 */
export function getPlayerChecksum(): string | null {
  if (cachedChecksum) return cachedChecksum

  if (!existsSync(PLAYER_BINARY_PATH)) {
    return null
  }

  const fileBuffer = readFileSync(PLAYER_BINARY_PATH)
  cachedChecksum = `sha256:${createHash('sha256').update(fileBuffer).digest('hex')}`
  return cachedChecksum
}

/**
 * Check if a player bundle is available
 */
export function hasPlayerBundle(): boolean {
  return existsSync(PLAYER_BINARY_PATH) && existsSync(PLAYER_VERSION_PATH)
}
