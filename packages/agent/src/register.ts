/**
 * Device Registration
 * Handles first-boot registration and approval polling.
 */

interface RegisterResponse {
  deviceId: number
  status: 'pending' | 'approved' | 'rejected'
}

interface StatusResponse {
  status: 'pending' | 'approved' | 'rejected'
  secret?: string
  name?: string
}

/**
 * Register this device with the server
 */
export async function register(
  serverUrl: string,
  hardwareId: string,
  hostname: string
): Promise<RegisterResponse> {
  const response = await fetch(`${serverUrl}/api/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hardwareId, hostname }),
  })

  if (!response.ok) {
    throw new Error(`Registration failed: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Poll for device approval
 * Returns when device is approved (with secret) or rejected
 * Times out after maxWaitTime to allow agent to exit and retry on next timer run
 */
export async function pollForApproval(
  serverUrl: string,
  deviceId: number,
  maxWaitTime: number = 10 * 60 * 1000 // 10 minutes default
): Promise<{ secret: string; name: string }> {
  const pollInterval = 5000 // 5 seconds
  const startTime = Date.now()

  while (true) {
    const response = await fetch(
      `${serverUrl}/api/devices/register/${deviceId}/status`
    )

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`)
    }

    const status: StatusResponse = await response.json()

    if (status.status === 'approved' && status.secret) {
      return { secret: status.secret, name: status.name || 'unknown' }
    }

    if (status.status === 'rejected') {
      throw new Error('Device registration was rejected')
    }

    // Check timeout
    if (Date.now() - startTime > maxWaitTime) {
      throw new Error(
        `Approval timeout after ${maxWaitTime / 1000}s. Device is still pending. ` +
        `Will retry on next agent run.`
      )
    }

    // Still pending, wait and try again
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }
}
