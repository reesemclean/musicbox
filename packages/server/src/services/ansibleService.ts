/**
 * Ansible Service - Push-based deployment to Raspberry Pi devices
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import { deploymentRuns, devices } from '../db/schema.js'
import {
  getSSHPrivateKeyPath,
  getSSHPublicKey,
  initializeSSHKeys,
} from '../lib/ssh-keys.js'
import { getPlayerVersion } from '../lib/player-bundle.js'
import { env } from '../env.js'
import type { DeploymentRunStatus } from '../db/schema.js'

// Paths
const ANSIBLE_DIR = join(process.cwd(), 'ansible')
const INVENTORY_PATH = join(process.cwd(), 'data', 'ansible-inventory.ini')
const DATA_DIR = join(process.cwd(), 'data')

// Playbook mapping
const PLAYBOOKS: Record<string, string> = {
  site: 'site.yml',
  'deploy-player': 'deploy-player.yml',
  'sync-config': 'sync-config.yml',
}

/**
 * Get the server's SSH public key
 */
export function getServerSSHPublicKey(): string {
  return getSSHPublicKey()
}

/**
 * Initialize SSH keys on startup
 */
export function initializeAnsible(): void {
  initializeSSHKeys()

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

/**
 * Generate Ansible inventory from approved devices
 */
export async function generateInventory(): Promise<string> {
  // Get all approved devices with IP addresses
  const approvedDevices = await db
    .select({
      id: devices.id,
      name: devices.name,
      ipAddress: devices.ipAddress,
      secret: devices.secret,
    })
    .from(devices)
    .where(and(eq(devices.status, 'approved'), isNotNull(devices.ipAddress)))

  // Get server URL from environment or construct it
  const serverUrl =
    process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`

  // Build inventory content
  const lines = ['[musicbox_devices]']

  for (const device of approvedDevices) {
    if (device.ipAddress) {
      lines.push(
        `${device.name} ansible_host=${device.ipAddress} device_id=${device.id} device_secret=${device.secret}`,
      )
    }
  }

  lines.push('')
  lines.push('[musicbox_devices:vars]')
  lines.push('ansible_user=pi')
  lines.push(`ansible_ssh_private_key_file=${getSSHPrivateKeyPath()}`)
  lines.push(`server_url=${serverUrl}`)
  lines.push(`player_version=${getPlayerVersion() || 'unknown'}`)
  lines.push('')

  const inventoryContent = lines.join('\n')

  // Write inventory file
  writeFileSync(INVENTORY_PATH, inventoryContent)

  return inventoryContent
}

/**
 * Run an Ansible playbook
 * @param playbook - Playbook name ('site', 'deploy-player', 'sync-config')
 * @param deviceId - Optional device ID to limit to single device
 * @returns Deployment run ID
 */
export async function runPlaybook(
  playbook: string,
  deviceId?: number,
): Promise<number> {
  console.log(`[ansible] Starting playbook: ${playbook}${deviceId ? ` for device ${deviceId}` : ' for all devices'}`)
  
  const playbookFile = PLAYBOOKS[playbook]
  if (!playbookFile) {
    console.error(`[ansible] Unknown playbook: ${playbook}`)
    throw new Error(`Unknown playbook: ${playbook}`)
  }

  const playbookPath = join(ANSIBLE_DIR, 'playbooks', playbookFile)
  if (!existsSync(playbookPath)) {
    console.error(`[ansible] Playbook not found: ${playbookPath}`)
    throw new Error(`Playbook not found: ${playbookPath}`)
  }

  // Generate fresh inventory
  console.log('[ansible] Generating inventory...')
  const inventory = await generateInventory()
  console.log(`[ansible] Inventory generated:\n${inventory}`)

  // Create deployment run record
  const [run] = await db
    .insert(deploymentRuns)
    .values({
      deviceId: deviceId ?? null,
      playbook,
      status: 'queued',
    })
    .returning()

  console.log(`[ansible] Created deployment run #${run.id}`)

  // Update device deployment status if specific device
  if (deviceId) {
    await db
      .update(devices)
      .set({ deploymentStatus: 'pending' })
      .where(eq(devices.id, deviceId))
  } else {
    // Update all approved devices
    await db
      .update(devices)
      .set({ deploymentStatus: 'pending' })
      .where(eq(devices.status, 'approved'))
  }

  // Build ansible-playbook command
  const args = ['-i', INVENTORY_PATH, playbookPath]

  // Pass musicbox password if configured
  if (env.MUSICBOX_PASSWORD) {
    args.push('-e', `musicbox_password=${env.MUSICBOX_PASSWORD}`)
  }

  // Limit to specific device if provided
  if (deviceId) {
    const device = await db.query.devices.findFirst({
      where: eq(devices.id, deviceId),
    })
    if (device) {
      args.push('-l', device.name)
    }
  }

  console.log(`[ansible] Running: ansible-playbook ${args.join(' ')}`)

  // Start playbook execution asynchronously
  executePlaybook(run.id, args, deviceId)

  return run.id
}

/**
 * Execute ansible-playbook and track output
 */
async function executePlaybook(
  runId: number,
  args: Array<string>,
  deviceId?: number,
): Promise<void> {
  const startedAt = new Date()
  console.log(`[ansible] Executing playbook for run #${runId}`)

  // Update run to running status
  await db
    .update(deploymentRuns)
    .set({
      status: 'running',
      startedAt,
    })
    .where(eq(deploymentRuns.id, runId))

  // Update device status
  if (deviceId) {
    await db
      .update(devices)
      .set({ deploymentStatus: 'deploying' })
      .where(eq(devices.id, deviceId))
  } else {
    await db
      .update(devices)
      .set({ deploymentStatus: 'deploying' })
      .where(eq(devices.status, 'approved'))
  }

  let output = ''

  try {
    const ansibleConfig = join(ANSIBLE_DIR, 'ansible.cfg')
    console.log(`[ansible] Using config: ${ansibleConfig}`)
    console.log(`[ansible] Working directory: ${ANSIBLE_DIR}`)
    
    const result = await new Promise<{ code: number; output: string }>(
      (resolve, reject) => {
        const proc = spawn('ansible-playbook', args, {
          cwd: ANSIBLE_DIR,
          env: {
            ...process.env,
            ANSIBLE_CONFIG: ansibleConfig,
            ANSIBLE_FORCE_COLOR: '0',
          },
        })

        proc.stdout.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          // Log output in real-time
          process.stdout.write(`[ansible] ${chunk}`)
        })

        proc.stderr.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          process.stderr.write(`[ansible] ${chunk}`)
        })

        proc.on('close', (code) => {
          console.log(`[ansible] Process exited with code ${code}`)
          resolve({ code: code ?? 1, output })
        })

        proc.on('error', (err) => {
          console.error(`[ansible] Process error:`, err)
          reject(err)
        })
      },
    )

    const completedAt = new Date()
    const status: DeploymentRunStatus = result.code === 0 ? 'success' : 'failed'
    console.log(`[ansible] Run #${runId} completed with status: ${status}`)

    // Update run record
    await db
      .update(deploymentRuns)
      .set({
        status,
        output: result.output,
        completedAt,
      })
      .where(eq(deploymentRuns.id, runId))

    // Update device status
    const deviceStatus = status === 'success' ? 'success' : 'failed'
    const playerVersion = getPlayerVersion()

    if (deviceId) {
      await db
        .update(devices)
        .set({
          deploymentStatus: deviceStatus,
          lastDeployedAt: status === 'success' ? completedAt : undefined,
          lastDeployedVersion: status === 'success' ? playerVersion : undefined,
        })
        .where(eq(devices.id, deviceId))
    } else {
      await db
        .update(devices)
        .set({
          deploymentStatus: deviceStatus,
          lastDeployedAt: status === 'success' ? completedAt : undefined,
          lastDeployedVersion: status === 'success' ? playerVersion : undefined,
        })
        .where(eq(devices.status, 'approved'))
    }
  } catch (error) {
    console.error(`[ansible] Run #${runId} failed with error:`, error)
    const completedAt = new Date()

    await db
      .update(deploymentRuns)
      .set({
        status: 'failed',
        output:
          output +
          '\n\nError: ' +
          (error instanceof Error ? error.message : String(error)),
        completedAt,
      })
      .where(eq(deploymentRuns.id, runId))

    // Update device status to failed
    if (deviceId) {
      await db
        .update(devices)
        .set({ deploymentStatus: 'failed' })
        .where(eq(devices.id, deviceId))
    } else {
      await db
        .update(devices)
        .set({ deploymentStatus: 'failed' })
        .where(eq(devices.status, 'approved'))
    }
  }
}

/**
 * Get deployment runs
 * @param limit - Max number of runs to return
 */
export async function getDeploymentRuns(limit = 50) {
  return db
    .select({
      id: deploymentRuns.id,
      deviceId: deploymentRuns.deviceId,
      playbook: deploymentRuns.playbook,
      status: deploymentRuns.status,
      startedAt: deploymentRuns.startedAt,
      completedAt: deploymentRuns.completedAt,
      createdAt: deploymentRuns.createdAt,
    })
    .from(deploymentRuns)
    .orderBy(desc(deploymentRuns.createdAt))
    .limit(limit)
}

/**
 * Get a specific deployment run with output
 */
export async function getDeploymentRun(runId: number) {
  return db.query.deploymentRuns.findFirst({
    where: eq(deploymentRuns.id, runId),
  })
}

/**
 * Get devices ready for deployment (approved with IP address)
 */
export async function getDeployableDevices() {
  return db
    .select({
      id: devices.id,
      name: devices.name,
      ipAddress: devices.ipAddress,
      deploymentStatus: devices.deploymentStatus,
      lastDeployedAt: devices.lastDeployedAt,
      lastDeployedVersion: devices.lastDeployedVersion,
    })
    .from(devices)
    .where(and(eq(devices.status, 'approved'), isNotNull(devices.ipAddress)))
    .orderBy(devices.name)
}
