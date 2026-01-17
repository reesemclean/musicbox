/**
 * Agent Self-Updates
 * Download and install agent updates, then restart via systemd.
 */

import {
  existsSync,
  readFileSync,
  mkdirSync,
  createWriteStream,
  rmSync,
  writeFileSync,
  cpSync,
} from 'fs'
import { execSync, spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { ReadableStream as WebReadableStream } from 'stream/web'

const AGENT_DIR = '/opt/musicbox-agent'
const VERSION_FILE = `${AGENT_DIR}/.version`
const BACKUP_DIR = '/opt/musicbox-agent.backup'
const SERVICE_NAME = 'musicbox-agent.service'

/**
 * Get currently installed agent version
 */
export function getCurrentAgentVersion(): string | null {
  if (existsSync(VERSION_FILE)) {
    return readFileSync(VERSION_FILE, 'utf-8').trim()
  }
  return null
}

/**
 * Ensure agent is at the desired version
 * Returns true if agent was updated (and will restart)
 */
export async function ensureAgent(
  serverUrl: string,
  version: string,
  url: string,
  _checksum: string,
): Promise<boolean> {
  const currentVersion = getCurrentAgentVersion()

  if (currentVersion === version) {
    return false
  }

  console.log(`[Agent Update] Current version: ${currentVersion || 'unknown'}`)
  console.log(`[Agent Update] Downloading agent ${version}...`)

  // Build full URL
  const downloadUrl = url.startsWith('http') ? url : `${serverUrl}${url}`
  const response = await fetch(downloadUrl)

  if (!response.ok) {
    throw new Error(`Failed to download agent: ${response.status}`)
  }

  const tarballPath = '/tmp/agent.tar.gz'
  const writeStream = createWriteStream(tarballPath)

  if (!response.body) {
    throw new Error('No response body')
  }

  // Download tarball
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream),
    writeStream,
  )

  // TODO: Verify checksum

  console.log(`[Agent Update] Installing agent ${version}...`)

  // Backup current version (in case we need to rollback)
  if (existsSync(AGENT_DIR)) {
    if (existsSync(BACKUP_DIR)) {
      rmSync(BACKUP_DIR, { recursive: true })
    }
    cpSync(AGENT_DIR, BACKUP_DIR, { recursive: true })
  }

  // Remove old version and create fresh directory
  if (existsSync(AGENT_DIR)) {
    rmSync(AGENT_DIR, { recursive: true })
  }
  mkdirSync(AGENT_DIR, { recursive: true })

  // Extract tarball
  execSync(`tar -xzf ${tarballPath} -C ${AGENT_DIR}`, { stdio: 'inherit' })

  // Write version file
  writeFileSync(VERSION_FILE, version)

  // Cleanup tarball
  rmSync(tarballPath)

  console.log(`[Agent Update] Agent ${version} installed successfully`)
  console.log(`[Agent Update] Restarting service...`)

  // Schedule restart after a short delay to allow this function to return
  // Use spawn with detached so it survives the process exit
  spawn('sh', ['-c', `sleep 2 && systemctl restart ${SERVICE_NAME}`], {
    detached: true,
    stdio: 'ignore',
  }).unref()

  return true
}
