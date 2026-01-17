/**
 * SSH key management for Ansible deployment
 *
 * Generates and manages SSH keys used for push-based deployment to Pis.
 * Keys are stored in /app/data/ssh/ (Docker volume) for persistence.
 */

import { execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// SSH key locations (relative to server root)
const SSH_DIR = join(process.cwd(), 'data', 'ssh')
const PRIVATE_KEY_PATH = join(SSH_DIR, 'id_ed25519')
const PUBLIC_KEY_PATH = join(SSH_DIR, 'id_ed25519.pub')

let cachedPublicKey: string | null = null

/**
 * Ensure SSH directory exists
 */
function ensureSSHDir(): void {
  if (!existsSync(SSH_DIR)) {
    mkdirSync(SSH_DIR, { recursive: true })
  }
}

/**
 * Generate new SSH keypair if none exists
 */
function generateKeyPair(): void {
  ensureSSHDir()

  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    return // Keys already exist
  }

  console.log(
    '[ssh-keys] Generating new ed25519 keypair for Ansible deployment...',
  )

  // Use ssh-keygen to generate the keypair
  execSync(
    `ssh-keygen -t ed25519 -f "${PRIVATE_KEY_PATH}" -N "" -C "musicbox-server"`,
    { stdio: 'pipe' },
  )

  // Ensure proper permissions
  chmodSync(PRIVATE_KEY_PATH, 0o600)
  chmodSync(PUBLIC_KEY_PATH, 0o644)

  console.log('[ssh-keys] SSH keypair generated successfully')
}

/**
 * Get the server's SSH public key for Ansible deployment
 * Generates keypair if it doesn't exist
 */
export function getSSHPublicKey(): string {
  if (cachedPublicKey) return cachedPublicKey

  generateKeyPair()

  if (!existsSync(PUBLIC_KEY_PATH)) {
    throw new Error('Failed to generate SSH public key')
  }

  cachedPublicKey = readFileSync(PUBLIC_KEY_PATH, 'utf-8').trim()
  return cachedPublicKey
}

/**
 * Get path to the SSH private key
 */
export function getSSHPrivateKeyPath(): string {
  generateKeyPair()
  return PRIVATE_KEY_PATH
}

/**
 * Check if SSH keys exist
 */
export function hasSSHKeys(): boolean {
  return existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)
}

/**
 * Initialize SSH keys (call on server startup)
 */
export function initializeSSHKeys(): void {
  generateKeyPair()
}
