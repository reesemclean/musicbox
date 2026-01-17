/**
 * State Reporting
 * Report device state to server.
 */

import { hostname } from 'os'
import { execSync } from 'child_process'

interface DeviceState {
  configVersion?: string
  playerVersion?: string
  agentVersion: string
  ip?: string
  hostname: string
  uptime?: number
  lastError?: string | null
}

/**
 * Get the device's IP address
 */
function getIpAddress(): string | undefined {
  try {
    // Get IP from hostname -I (first IP)
    const output = execSync('hostname -I', { encoding: 'utf-8' })
    const ips = output.trim().split(/\s+/)
    return ips[0] || undefined
  } catch {
    return undefined
  }
}

/**
 * Get system uptime in seconds
 */
function getUptime(): number {
  try {
    const output = execSync("cat /proc/uptime | awk '{print $1}'", {
      encoding: 'utf-8',
    })
    return Math.floor(parseFloat(output.trim()))
  } catch {
    return 0
  }
}

/**
 * Report device state to server
 */
export async function reportState(
  serverUrl: string,
  deviceSecret: string,
  state: {
    configVersion?: string
    playerVersion?: string
    agentVersion: string
    lastError?: string | null
  }
): Promise<void> {
  const fullState: DeviceState = {
    ...state,
    ip: getIpAddress(),
    hostname: hostname(),
    uptime: getUptime(),
  }

  const response = await fetch(
    `${serverUrl}/api/devices/by-secret/${deviceSecret}/state`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullState),
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to report state: ${response.status}`)
  }
}
