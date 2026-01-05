/**
 * Devices Service - Device management and heartbeat handling
 */

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'

/**
 * Create a new device
 * @param name - Unique device name
 * @returns The created device
 */
export async function createDevice(name: string) {
  const secret = randomUUID()

  const [device] = await db
    .insert(devices)
    .values({
      name,
      secret,
      httpPort: 8080,
    })
    .returning()

  return device
}

/**
 * Calculate device status based on last heartbeat
 * @param lastSeen - Last heartbeat timestamp
 * @returns 'online', 'offline', or 'inactive'
 */
function calculateDeviceStatus(
  lastSeen: Date | null,
): 'online' | 'offline' | 'inactive' {
  if (!lastSeen) {
    return 'inactive'
  }

  const now = Date.now()
  const lastSeenTime = lastSeen.getTime()
  const minutesSinceLastSeen = (now - lastSeenTime) / (60 * 1000)

  // Consider offline after 2 minutes without heartbeat (heartbeat interval is 30s)
  return minutesSinceLastSeen < 2 ? 'online' : 'offline'
}

/**
 * Get all devices
 */
export async function getAllDevices() {
  const allDevices = await db
    .select({
      id: devices.id,
      name: devices.name,
      ipAddress: devices.ipAddress,
      httpPort: devices.httpPort,
      lastSeen: devices.lastSeen,
      currentSong: devices.currentSong,
    })
    .from(devices)
    .orderBy(devices.name)

  // Calculate status on the fly
  return allDevices.map((device) => ({
    ...device,
    status: calculateDeviceStatus(device.lastSeen),
  }))
} /**
 * Update device heartbeat with current status
 * @param secret - Device authentication secret
 * @param ipAddress - Current IP address
 * @param currentSong - Current playback status (optional)
 */
export async function updateDeviceHeartbeat(
  secret: string,
  ipAddress: string,
  currentSong?: { title: string; artist?: string; isPlaying: boolean },
) {
  const now = new Date()

  await db
    .update(devices)
    .set({
      ipAddress,
      lastSeen: now,
      currentSong: currentSong ? JSON.stringify(currentSong) : null,
    })
    .where(eq(devices.secret, secret))

  return { success: true }
}

/**
 * Get device by secret (for player authentication)
 * @param secret - Device authentication secret
 */
export async function getDeviceBySecret(secret: string) {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.secret, secret))
    .limit(1)

  return device
}

/**
 * Get device by ID
 * @param deviceId - Device ID
 */
export async function getDeviceById(deviceId: number) {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1)

  return device
}
