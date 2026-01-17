/**
 * System utilities
 * Hardware ID, hostname, and system commands.
 */

import { execSync } from 'child_process'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { hostname } from 'os'

/**
 * Get the hardware ID (CPU serial number)
 */
export async function getHardwareId(): Promise<string> {
  // Try to read from /proc/cpuinfo (Raspberry Pi)
  if (existsSync('/proc/cpuinfo')) {
    const cpuinfo = readFileSync('/proc/cpuinfo', 'utf-8')
    const match = cpuinfo.match(/Serial\s*:\s*([0-9a-fA-F]+)/)
    if (match) {
      return match[1].toLowerCase()
    }
  }

  // Fallback: generate from machine-id
  if (existsSync('/etc/machine-id')) {
    return readFileSync('/etc/machine-id', 'utf-8').trim()
  }

  // Last resort: use hostname
  return `unknown-${hostname()}`
}

/**
 * Get the system hostname
 */
export function getHostname(): string {
  return hostname()
}

/**
 * Set the system hostname
 * Format: musicbox-<name> (sanitized to valid hostname chars)
 */
export function setHostname(deviceName: string): void {
  // Sanitize name: lowercase, replace spaces/invalid chars with dashes
  const sanitized = deviceName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 58) // Max 63 chars total, minus "musicbox-" prefix

  const newHostname = `musicbox-${sanitized || 'player'}`
  const currentHostname = hostname()

  if (currentHostname === newHostname) {
    return
  }

  console.log(`Setting hostname: ${newHostname}`)

  // Update hostname immediately
  execSync(`hostnamectl set-hostname ${newHostname}`, { stdio: 'inherit' })

  // Update /etc/hosts
  try {
    const hosts = readFileSync('/etc/hosts', 'utf-8')
    const updatedHosts = hosts.replace(
      new RegExp(`127\\.0\\.1\\.1\\s+${currentHostname}`, 'g'),
      `127.0.1.1\t${newHostname}`
    )
    writeFileSync('/etc/hosts', updatedHosts)
  } catch (err) {
    console.error('Failed to update /etc/hosts:', err)
  }
}

/**
 * Reboot the system
 */
export function reboot(): void {
  console.log('Rebooting system...')
  execSync('reboot', { stdio: 'inherit' })
}

/**
 * Get agent version from package.json
 */
export function getAgentVersion(): string {
  try {
    const pkgPath = new URL('../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}
