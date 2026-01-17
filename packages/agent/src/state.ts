/**
 * Desired State Management
 * Fetch and parse desired state from server.
 */

export interface FileSpec {
  content: string
  checksum: string
}

export interface DesiredState {
  configVersion: string | null
  system: {
    packages: string[]
    files: Record<string, FileSpec>
  }
  player: {
    version: string
    url: string
    checksum: string
  } | null
  services: Record<string, { enabled: boolean }>
}

/**
 * Fetch desired state from server
 */
export async function fetchDesiredState(
  serverUrl: string,
  deviceSecret: string
): Promise<DesiredState> {
  const response = await fetch(
    `${serverUrl}/api/devices/by-secret/${deviceSecret}/desired-state`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch desired state: ${response.status}`)
  }

  return response.json()
}
