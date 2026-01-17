/**
 * Agent Configuration
 * Loads local configuration from boot partition files.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'

const BOOT_CONFIG_PATH = '/boot/firmware/musicbox/config.txt'
const DEVICE_SECRET_PATH = '/boot/firmware/musicbox/device.txt'
const DEFAULT_SERVER_URL = 'http://musicbox.local:3000'

export interface LocalConfig {
  serverUrl: string
  deviceSecret: string | null
}

/**
 * Load configuration from boot partition files
 */
export function loadLocalConfig(): LocalConfig {
  let serverUrl = DEFAULT_SERVER_URL
  let deviceSecret: string | null = null

  // Load server URL override
  if (existsSync(BOOT_CONFIG_PATH)) {
    const content = readFileSync(BOOT_CONFIG_PATH, 'utf-8')
    const match = content.match(/^SERVER_URL=(.+)$/m)
    if (match) {
      serverUrl = match[1].trim()
    }
  }

  // Load device secret if exists
  if (existsSync(DEVICE_SECRET_PATH)) {
    deviceSecret = readFileSync(DEVICE_SECRET_PATH, 'utf-8').trim()
  }

  return { serverUrl, deviceSecret }
}

/**
 * Save device secret to boot partition
 */
export function saveDeviceSecret(secret: string): void {
  writeFileSync(DEVICE_SECRET_PATH, secret, { mode: 0o600 })
}
