/**
 * Devices Service - Device management and heartbeat handling
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices } from '../db/schema.js'
import type { DeviceStatus } from '../db/schema.js'

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
 * @returns Device or undefined if not found
 */
export async function getDeviceBySecret(secret: string) {
  return db.query.devices.findFirst({
    where: eq(devices.secret, secret),
  })
}

/**
 * Get device by ID
 * @param deviceId - Device ID
 * @returns Device or undefined if not found
 */
export async function getDeviceById(deviceId: number) {
  return db.query.devices.findFirst({
    where: eq(devices.id, deviceId),
  })
}

/**
 * Register a new device (called from agent on first boot)
 * Creates a pending device that needs admin approval
 * @param hardwareId - CPU serial number
 * @param hostname - Device hostname
 */
export async function registerDevice(hardwareId: string, hostname: string) {
  // Check if device already exists with this hardware ID
  const existing = await db.query.devices.findFirst({
    where: eq(devices.hardwareId, hardwareId),
  })

  if (existing) {
    // Return existing device info
    return {
      deviceId: existing.id,
      status: existing.status as DeviceStatus,
      isExisting: true,
    }
  }

  // Create new pending device
  const secret = randomUUID()
  const tempName = `device-${hardwareId.slice(-8)}`

  const [device] = await db
    .insert(devices)
    .values({
      name: tempName,
      secret,
      hardwareId,
      hostname,
      status: 'pending',
      httpPort: 8080,
    })
    .returning()

  return {
    deviceId: device.id,
    status: 'pending' as DeviceStatus,
    isExisting: false,
  }
}

/**
 * Get registration status for a device
 * @param deviceId - Device ID
 */
export async function getRegistrationStatus(deviceId: number) {
  const device = await db.query.devices.findFirst({
    where: eq(devices.id, deviceId),
    columns: {
      id: true,
      status: true,
      secret: true,
      name: true,
    },
  })

  if (!device) {
    return null
  }

  return {
    status: device.status as DeviceStatus,
    // Only include secret if approved
    secret: device.status === 'approved' ? device.secret : undefined,
    name: device.status === 'approved' ? device.name : undefined,
  }
}

/**
 * Approve a pending device
 * @param deviceId - Device ID
 * @param name - Friendly name for the device
 * @returns Device or null if not found/not pending
 */
export async function approveDevice(deviceId: number, name: string) {
  const now = new Date()

  return db
    .update(devices)
    .set({
      status: 'approved',
      name,
      approvedAt: now,
    })
    .where(and(eq(devices.id, deviceId), eq(devices.status, 'pending')))
    .returning()
    .then((rows) => rows.at(0) ?? null)
}

/**
 * Reject a pending device
 * @param deviceId - Device ID
 * @returns Device or null if not found/not pending
 */
export async function rejectDevice(deviceId: number) {
  return db
    .update(devices)
    .set({
      status: 'rejected',
    })
    .where(and(eq(devices.id, deviceId), eq(devices.status, 'pending')))
    .returning()
    .then((rows) => rows.at(0) ?? null)
}

/**
 * Get all pending devices
 */
export async function getPendingDevices() {
  const pending = await db
    .select({
      id: devices.id,
      hardwareId: devices.hardwareId,
      hostname: devices.hostname,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(eq(devices.status, 'pending'))
    .orderBy(devices.createdAt)

  return pending
}

/**
 * Update device state reported by agent
 * @param secret - Device secret
 * @param state - Reported state from agent
 */
export async function updateDeviceState(
  secret: string,
  state: {
    configVersion?: string
    playerVersion?: string
    agentVersion?: string
    ip?: string
    hostname?: string
    uptime?: number
    lastError?: string | null
  },
) {
  const now = new Date()

  await db
    .update(devices)
    .set({
      reportedConfigVersion: state.configVersion,
      reportedPlayerVersion: state.playerVersion,
      reportedAgentVersion: state.agentVersion,
      ipAddress: state.ip,
      hostname: state.hostname,
      lastSeen: now,
    })
    .where(eq(devices.secret, secret))

  return { success: true }
}
