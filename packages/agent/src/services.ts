/**
 * Service Management
 * Manage systemd services.
 */

import { execSync } from 'child_process'

/**
 * Check if a service is enabled
 */
function isServiceEnabled(service: string): boolean {
  try {
    execSync(`systemctl is-enabled ${service}`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/**
 * Enable a systemd service
 */
function enableService(service: string): void {
  console.log(`Enabling service: ${service}`)
  execSync(`systemctl enable ${service}`, { stdio: 'inherit' })
}

/**
 * Disable a systemd service
 */
function disableService(service: string): void {
  console.log(`Disabling service: ${service}`)
  execSync(`systemctl disable ${service}`, { stdio: 'inherit' })
}

/**
 * Restart a systemd service
 */
export async function restartService(service: string): Promise<void> {
  console.log(`Restarting service: ${service}`)
  execSync(`systemctl restart ${service}`, { stdio: 'inherit' })
}

/**
 * Reload systemd daemon
 */
export async function reloadDaemon(): Promise<void> {
  console.log('Reloading systemd daemon...')
  execSync('systemctl daemon-reload', { stdio: 'inherit' })
}

/**
 * Ensure services match desired state
 */
export async function ensureServices(
  services: Record<string, { enabled: boolean }>
): Promise<void> {
  for (const [service, config] of Object.entries(services)) {
    const currentlyEnabled = isServiceEnabled(service)

    if (config.enabled && !currentlyEnabled) {
      enableService(service)
    } else if (!config.enabled && currentlyEnabled) {
      disableService(service)
    }
  }
}
