/**
 * Ansible Service - Push-based deployment to Raspberry Pi devices
 */

import { execSync, spawn } from 'node:child_process'
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
import { getPlayerChecksum, getPlayerVersion } from '../lib/player-bundle.js'
import { env } from '../env.js'
import type {ChildProcess} from 'node:child_process';
import type { DeploymentRunStatus } from '../db/schema.js'

// Paths
const ANSIBLE_DIR = join(process.cwd(), 'ansible')
const INVENTORY_PATH = join(process.cwd(), 'data', 'ansible-inventory.ini')
const DATA_DIR = join(process.cwd(), 'data')

// Track running Ansible processes by run ID
const runningProcesses = new Map<number, ChildProcess>()

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
  console.log('[ansible:init] Initializing Ansible service...')
  console.log(`[ansible:init] ANSIBLE_DIR: ${ANSIBLE_DIR}`)
  console.log(`[ansible:init] INVENTORY_PATH: ${INVENTORY_PATH}`)
  console.log(`[ansible:init] DATA_DIR: ${DATA_DIR}`)

  initializeSSHKeys()
  console.log('[ansible:init] SSH keys initialized')

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
    console.log(`[ansible:init] Created data directory: ${DATA_DIR}`)
  }

  // Log ansible-playbook availability
  try {
    const version = execSync('ansible-playbook --version', {
      encoding: 'utf8',
    }).split('\n')[0]
    console.log(`[ansible:init] ansible-playbook available: ${version}`)
  } catch {
    console.warn('[ansible:init] WARNING: ansible-playbook not found in PATH')
    console.warn(
      '[ansible:init] Deployments will fail until ansible is installed',
    )
  }

  console.log('[ansible:init] Ansible service ready')
}

/**
 * Generate Ansible inventory from approved devices
 */
export async function generateInventory(): Promise<string> {
  console.log(
    '[ansible:inventory] Querying approved devices with IP addresses...',
  )

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

  console.log(
    `[ansible:inventory] Found ${approvedDevices.length} deployable device(s)`,
  )

  if (approvedDevices.length === 0) {
    console.warn(
      '[ansible:inventory] WARNING: No devices found with status=approved AND ipAddress set',
    )
    console.warn(
      '[ansible:inventory] Deployment will have no targets - check device registration status',
    )
  } else {
    for (const device of approvedDevices) {
      console.log(
        `[ansible:inventory]   - ${device.name} (id=${device.id}, ip=${device.ipAddress})`,
      )
    }
  }

  // Get server URL from environment or construct it
  const serverUrl =
    process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`
  console.log(`[ansible:inventory] Server URL: ${serverUrl}`)

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
  lines.push('ansible_user=musicbox')
  lines.push(`ansible_ssh_private_key_file=${getSSHPrivateKeyPath()}`)
  lines.push(`server_url=${serverUrl}`)
  // Use checksum for version comparison - any bundle change triggers re-download
  lines.push(`player_version=${getPlayerChecksum() || getPlayerVersion() || 'unknown'}`)
  lines.push('')

  const inventoryContent = lines.join('\n')

  // Write inventory file
  writeFileSync(INVENTORY_PATH, inventoryContent)
  console.log(`[ansible:inventory] Wrote inventory to ${INVENTORY_PATH}`)

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
  const startTime = Date.now()
  const target = deviceId ? `device ${deviceId}` : 'all devices'
  console.log(`[ansible:run] ========== Starting deployment ==========`)
  console.log(`[ansible:run] Playbook: ${playbook}`)
  console.log(`[ansible:run] Target: ${target}`)
  console.log(`[ansible:run] Time: ${new Date().toISOString()}`)

  const playbookFile = PLAYBOOKS[playbook]
  if (!playbookFile) {
    console.error(`[ansible:run] ERROR: Unknown playbook "${playbook}"`)
    console.error(
      `[ansible:run] Available playbooks: ${Object.keys(PLAYBOOKS).join(', ')}`,
    )
    throw new Error(`Unknown playbook: ${playbook}`)
  }

  const playbookPath = join(ANSIBLE_DIR, 'playbooks', playbookFile)
  if (!existsSync(playbookPath)) {
    console.error(
      `[ansible:run] ERROR: Playbook file not found: ${playbookPath}`,
    )
    throw new Error(`Playbook not found: ${playbookPath}`)
  }
  console.log(`[ansible:run] Playbook path: ${playbookPath}`)

  // Generate fresh inventory
  console.log('[ansible:run] Generating inventory...')
  await generateInventory()
  console.log(
    `[ansible:run] Inventory generation completed in ${Date.now() - startTime}ms`,
  )

  // Create deployment run record
  const [run] = await db
    .insert(deploymentRuns)
    .values({
      deviceId: deviceId ?? null,
      playbook,
      status: 'queued',
    })
    .returning()

  console.log(`[ansible:run] Created deployment run #${run.id}`)

  // Update device deployment status if specific device
  if (deviceId) {
    console.log(
      `[ansible:run] Setting device ${deviceId} deploymentStatus to 'pending'`,
    )
    await db
      .update(devices)
      .set({ deploymentStatus: 'pending' })
      .where(eq(devices.id, deviceId))
  } else {
    console.log(
      `[ansible:run] Setting all approved devices deploymentStatus to 'pending'`,
    )
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
    console.log(`[ansible:run] Passing MUSICBOX_PASSWORD as extra variable`)
  }

  // Limit to specific device if provided
  if (deviceId) {
    const device = await db.query.devices.findFirst({
      where: eq(devices.id, deviceId),
    })
    if (device) {
      args.push('-l', device.name)
      console.log(`[ansible:run] Limiting to device: ${device.name}`)
    } else {
      console.warn(
        `[ansible:run] WARNING: Device ${deviceId} not found in database`,
      )
    }
  }

  // Log the command (redacting secrets)
  const redactedArgs = args.map((arg) =>
    arg.includes('device_secret') ? '[REDACTED]' : arg,
  )
  console.log(
    `[ansible:run] Command: ansible-playbook ${redactedArgs.join(' ')}`,
  )

  // Start playbook execution asynchronously
  console.log(`[ansible:run] Launching ansible-playbook process...`)
  executePlaybook(run.id, args, deviceId)

  console.log(
    `[ansible:run] Run #${run.id} queued, setup took ${Date.now() - startTime}ms`,
  )
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
  const startTime = Date.now()
  const target = deviceId ? `device ${deviceId}` : 'all approved devices'

  console.log(`[ansible:exec] ---------- Run #${runId} starting ----------`)
  console.log(`[ansible:exec] Target: ${target}`)
  console.log(`[ansible:exec] Started at: ${startedAt.toISOString()}`)

  // Update run to running status
  await db
    .update(deploymentRuns)
    .set({
      status: 'running',
      startedAt,
    })
    .where(eq(deploymentRuns.id, runId))
  console.log(`[ansible:exec] Run #${runId} status updated to 'running'`)

  // Update device status
  if (deviceId) {
    console.log(
      `[ansible:exec] Setting device ${deviceId} deploymentStatus to 'deploying'`,
    )
    await db
      .update(devices)
      .set({ deploymentStatus: 'deploying' })
      .where(eq(devices.id, deviceId))
  } else {
    console.log(
      `[ansible:exec] Setting all approved devices deploymentStatus to 'deploying'`,
    )
    await db
      .update(devices)
      .set({ deploymentStatus: 'deploying' })
      .where(eq(devices.status, 'approved'))
  }

  let output = ''

  try {
    const ansibleConfig = join(ANSIBLE_DIR, 'ansible.cfg')
    console.log(`[ansible:exec] Ansible config: ${ansibleConfig}`)
    console.log(`[ansible:exec] Working directory: ${ANSIBLE_DIR}`)
    console.log(`[ansible:exec] Spawning ansible-playbook process...`)

    const result = await new Promise<{ code: number; output: string; cancelled?: boolean }>(
      (resolve, reject) => {
        const proc = spawn('ansible-playbook', args, {
          cwd: ANSIBLE_DIR,
          env: {
            ...process.env,
            ANSIBLE_CONFIG: ansibleConfig,
            ANSIBLE_FORCE_COLOR: '0',
          },
        })

        // Track the process for cancellation
        runningProcesses.set(runId, proc)

        console.log(`[ansible:exec] Process spawned with PID: ${proc.pid}`)

        proc.stdout.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          // Log output in real-time with prefix for each line
          for (const line of chunk.split('\n')) {
            if (line.trim()) {
              console.log(`[ansible:output] ${line}`)
            }
          }
        })

        proc.stderr.on('data', (data) => {
          const chunk = data.toString()
          output += chunk
          // Log stderr with different prefix
          for (const line of chunk.split('\n')) {
            if (line.trim()) {
              console.error(`[ansible:stderr] ${line}`)
            }
          }
        })

        proc.on('close', (code, signal) => {
          // Clean up process tracking
          runningProcesses.delete(runId)

          const duration = ((Date.now() - startTime) / 1000).toFixed(1)
          
          // Check if process was killed (cancelled)
          if (signal === 'SIGTERM' || signal === 'SIGKILL') {
            console.log(
              `[ansible:exec] Process was cancelled (signal: ${signal}) after ${duration}s`,
            )
            resolve({ code: code ?? 1, output, cancelled: true })
          } else {
            console.log(
              `[ansible:exec] Process exited with code ${code} after ${duration}s`,
            )
            resolve({ code: code ?? 1, output })
          }
        })

        proc.on('error', (err) => {
          // Clean up process tracking
          runningProcesses.delete(runId)

          console.error(`[ansible:exec] Process spawn error:`, err)
          console.error(
            `[ansible:exec] This may indicate ansible-playbook is not installed or not in PATH`,
          )
          reject(err)
        })
      },
    )

    const completedAt = new Date()
    const duration = (
      (completedAt.getTime() - startedAt.getTime()) /
      1000
    ).toFixed(1)
    
    // Determine status based on result
    let status: DeploymentRunStatus
    if (result.cancelled) {
      status = 'failed' // We'll treat cancelled as failed, could add 'cancelled' status later
    } else {
      status = result.code === 0 ? 'success' : 'failed'
    }

    console.log(`[ansible:exec] ---------- Run #${runId} finished ----------`)
    console.log(`[ansible:exec] Status: ${status}${result.cancelled ? ' (cancelled)' : ''}`)
    console.log(`[ansible:exec] Exit code: ${result.code}`)
    console.log(`[ansible:exec] Duration: ${duration}s`)
    console.log(`[ansible:exec] Completed at: ${completedAt.toISOString()}`)

    if (status === 'failed' && !result.cancelled) {
      console.error(
        `[ansible:exec] DEPLOYMENT FAILED - Review ansible:output and ansible:stderr logs above`,
      )
      // Log last few lines of output for quick diagnosis
      const lastLines = result.output.split('\n').slice(-10).join('\n')
      console.error(`[ansible:exec] Last 10 lines of output:\n${lastLines}`)
    }

    // Update run record
    await db
      .update(deploymentRuns)
      .set({
        status,
        output: result.output,
        completedAt,
      })
      .where(eq(deploymentRuns.id, runId))
    console.log(`[ansible:exec] Run #${runId} record updated in database`)

    // Update device status
    const deviceStatus = status === 'success' ? 'success' : 'failed'
    const playerVersion = getPlayerVersion()

    if (deviceId) {
      console.log(
        `[ansible:exec] Updating device ${deviceId}: deploymentStatus=${deviceStatus}`,
      )
      await db
        .update(devices)
        .set({
          deploymentStatus: deviceStatus,
          lastDeployedAt: status === 'success' ? completedAt : undefined,
          lastDeployedVersion: status === 'success' ? playerVersion : undefined,
        })
        .where(eq(devices.id, deviceId))
    } else {
      console.log(
        `[ansible:exec] Updating all approved devices: deploymentStatus=${deviceStatus}`,
      )
      await db
        .update(devices)
        .set({
          deploymentStatus: deviceStatus,
          lastDeployedAt: status === 'success' ? completedAt : undefined,
          lastDeployedVersion: status === 'success' ? playerVersion : undefined,
        })
        .where(eq(devices.status, 'approved'))
    }

    if (status === 'success') {
      console.log(`[ansible:exec] ✓ Deployment successful for ${target}`)
    }
  } catch (error) {
    const completedAt = new Date()
    const duration = (
      (completedAt.getTime() - startedAt.getTime()) /
      1000
    ).toFixed(1)

    console.error(`[ansible:exec] ---------- Run #${runId} CRASHED ----------`)
    console.error(`[ansible:exec] Duration before crash: ${duration}s`)
    console.error(
      `[ansible:exec] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`,
    )
    console.error(
      `[ansible:exec] Error message: ${error instanceof Error ? error.message : String(error)}`,
    )
    if (error instanceof Error && error.stack) {
      console.error(`[ansible:exec] Stack trace:\n${error.stack}`)
    }

    await db
      .update(deploymentRuns)
      .set({
        status: 'failed',
        output:
          output +
          '\n\n=== EXECUTION ERROR ===\n' +
          (error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error)),
        completedAt,
      })
      .where(eq(deploymentRuns.id, runId))

    // Update device status to failed
    if (deviceId) {
      console.log(
        `[ansible:exec] Setting device ${deviceId} deploymentStatus to 'failed'`,
      )
      await db
        .update(devices)
        .set({ deploymentStatus: 'failed' })
        .where(eq(devices.id, deviceId))
    } else {
      console.log(
        `[ansible:exec] Setting all approved devices deploymentStatus to 'failed'`,
      )
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
 * Cancel a running deployment
 * @param runId - Deployment run ID to cancel
 * @returns true if cancelled, false if not running
 */
export async function cancelDeployment(runId: number): Promise<boolean> {
  console.log(`[ansible:cancel] Attempting to cancel run #${runId}`)

  const proc = runningProcesses.get(runId)
  if (!proc) {
    // Check if the run exists and is in a cancellable state
    const run = await db.query.deploymentRuns.findFirst({
      where: eq(deploymentRuns.id, runId),
    })

    if (!run) {
      console.log(`[ansible:cancel] Run #${runId} not found`)
      return false
    }

    if (run.status === 'queued' || run.status === 'running') {
      // Process might have finished between check and cancel, or server restarted
      console.log(
        `[ansible:cancel] Run #${runId} is ${run.status} but no process found - marking as failed`,
      )
      await db
        .update(deploymentRuns)
        .set({
          status: 'failed',
          output: (run.output || '') + '\n\n=== CANCELLED ===\nDeployment was cancelled by user.',
          completedAt: new Date(),
        })
        .where(eq(deploymentRuns.id, runId))
      return true
    }

    console.log(`[ansible:cancel] Run #${runId} is already ${run.status}`)
    return false
  }

  // Kill the process
  console.log(`[ansible:cancel] Killing process for run #${runId} (PID: ${proc.pid})`)
  proc.kill('SIGTERM')

  // Give it a moment, then force kill if still running
  setTimeout(() => {
    if (runningProcesses.has(runId)) {
      console.log(`[ansible:cancel] Force killing process for run #${runId}`)
      proc.kill('SIGKILL')
    }
  }, 5000)

  return true
}

/**
 * Check if a deployment is currently running for a device
 */
export function hasActiveDeployment(deviceId?: number): boolean {
  if (!deviceId) {
    return runningProcesses.size > 0
  }
  // Note: We'd need to track deviceId -> runId mapping for precise check
  // For now, return true if any deployment is running
  return runningProcesses.size > 0
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
