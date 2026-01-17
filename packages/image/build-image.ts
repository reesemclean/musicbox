#!/usr/bin/env node
/**
 * MusicBox Image Builder
 * Creates a ready-to-flash Raspberry Pi image with all settings pre-configured
 *
 * Usage:
 *   node --experimental-transform-types build-image.ts
 *   node --experimental-transform-types build-image.ts --interactive
 *   node --experimental-transform-types build-image.ts --clean
 */

import { execSync, spawn } from 'child_process'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  cpSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { tmpdir } from 'os'
import readline from 'readline'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '../..')
const BUILD_DIR = join(tmpdir(), 'musicbox-image-build')
const PIGEN_DIR = join(BUILD_DIR, 'pi-gen')
const OUTPUT_DIR = join(PROJECT_ROOT, 'outputs')
const CONFIG_FILE = join(__dirname, 'build-config.json')

// Colors
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  blue: '\x1b[0;34m',
  yellow: '\x1b[1;33m',
  reset: '\x1b[0m',
}

const log = {
  info: (msg: string) => console.log(`${colors.blue}${msg}${colors.reset}`),
  success: (msg: string) =>
    console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  error: (msg: string) =>
    console.log(`${colors.red}ERROR: ${msg}${colors.reset}`),
  warning: (msg: string) =>
    console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  header: (msg: string) => {
    console.log(`${colors.blue}=== ${msg} ===${colors.reset}`)
  },
}

interface BuildConfig {
  serverUrl: string
  sshKeyFile?: string
  sshKeyContent?: string
  timezone: string
  wifi?: {
    ssid: string
    password: string
    country: string
  }
}

// ============================================
// Utility Functions
// ============================================

function exec(cmd: string, options: { cwd?: string; silent?: boolean } = {}) {
  return execSync(cmd, {
    cwd: options.cwd,
    stdio: options.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
  })
}

function execSilent(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

async function prompt(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const displayQuestion = defaultValue
    ? `${question} [${defaultValue}]: `
    : `${question}: `

  return new Promise((resolve) => {
    rl.question(displayQuestion, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    // Disable echoing
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }

    process.stdout.write(question + ': ')

    let password = ''
    process.stdin.on('data', (char) => {
      const c = char.toString()
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode(false)
        console.log()
        rl.close()
        resolve(password)
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(1)
      } else if (c === '\u007F') {
        // Backspace
        password = password.slice(0, -1)
      } else {
        password += c
      }
    })
  })
}

async function promptYesNo(
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await prompt(`${question} [${hint}]`)
  if (!answer) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

function checkDocker(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function getSystemTimezone(): string {
  // macOS
  if (existsSync('/etc/localtime')) {
    const link = execSilent('readlink /etc/localtime')
    const match = link.match(/zoneinfo\/(.+)$/)
    if (match) return match[1]
  }
  // Linux
  if (existsSync('/etc/timezone')) {
    return readFileSync('/etc/timezone', 'utf-8').trim()
  }
  return 'America/New_York'
}

function findSshKeys(): string[] {
  const sshDir = join(process.env.HOME || '~', '.ssh')
  if (!existsSync(sshDir)) return []

  return readdirSync(sshDir)
    .filter((f) => f.endsWith('.pub'))
    .map((f) => join(sshDir, f))
}

// ============================================
// Interactive Prompts
// ============================================

async function promptServerUrl(): Promise<string> {
  console.log(`${colors.yellow}Server URL${colors.reset}`)
  console.log('Enter the MusicBox server URL (where players connect to):')
  return await prompt('Server URL', 'http://musicbox.local:3000')
}

async function promptSshKey(): Promise<string> {
  console.log(`\n${colors.yellow}SSH Public Key${colors.reset}`)
  console.log('Select an SSH public key for remote access:\n')

  const sshKeys = findSshKeys()

  if (sshKeys.length === 0) {
    log.warning('No SSH keys found in ~/.ssh')
    console.log('You can:')
    console.log('  1) Continue without SSH key (not recommended)')
    console.log('  2) Enter a key manually')

    const choice = await prompt('Choice', '1')
    if (choice === '2') {
      return await prompt('Paste your SSH public key')
    }
    return ''
  }

  console.log('Available keys:')
  sshKeys.forEach((keyFile, i) => {
    const content = readFileSync(keyFile, 'utf-8').trim()
    const parts = content.split(' ')
    const keyType = parts[0] || 'unknown'
    const comment = parts[2] || ''
    console.log(`  ${i + 1}) ${basename(keyFile)} (${keyType}) ${comment}`)
  })
  console.log(`  ${sshKeys.length + 1}) Enter manually`)
  console.log(`  ${sshKeys.length + 2}) Skip (no SSH key)`)

  const choice = await prompt('Select key', '1')
  const index = parseInt(choice) - 1

  if (index >= 0 && index < sshKeys.length) {
    const keyContent = readFileSync(sshKeys[index], 'utf-8').trim()
    log.success(`Using: ${basename(sshKeys[index])}`)
    return keyContent
  } else if (choice === String(sshKeys.length + 1)) {
    return await prompt('Paste your SSH public key')
  }

  log.warning('No SSH key configured')
  return ''
}

async function promptTimezone(): Promise<string> {
  console.log(`\n${colors.yellow}Timezone${colors.reset}`)
  const systemTz = getSystemTimezone()
  console.log(
    'Enter timezone (e.g., America/New_York, Europe/London, Asia/Tokyo):',
  )
  return await prompt('Timezone', systemTz)
}

async function promptWifi(): Promise<BuildConfig['wifi'] | undefined> {
  console.log(`\n${colors.yellow}WiFi Configuration${colors.reset}`)
  console.log('Configure WiFi to be embedded in the image?')

  const configureWifi = await promptYesNo('Configure WiFi?', true)
  if (!configureWifi) {
    console.log('WiFi will not be pre-configured')
    console.log('You can configure it later via the boot partition')
    return undefined
  }

  const ssid = await prompt('WiFi SSID (network name)')
  if (!ssid) {
    log.warning('No SSID provided, skipping WiFi configuration')
    return undefined
  }

  const password = await promptPassword('WiFi Password')
  const country = await prompt('WiFi Country Code', 'US')

  log.success(`WiFi will be configured for: ${ssid}`)

  return { ssid, password, country }
}

async function gatherConfigInteractively(): Promise<BuildConfig> {
  const serverUrl = await promptServerUrl()
  const sshKeyContent = await promptSshKey()
  const timezone = await promptTimezone()
  const wifi = await promptWifi()

  return {
    serverUrl,
    sshKeyContent,
    timezone,
    wifi,
  }
}

function loadConfigFromFile(): BuildConfig {
  if (!existsSync(CONFIG_FILE)) {
    log.error(`Config file not found: ${CONFIG_FILE}`)
    console.log('\nCreate it with:')
    console.log('  cp build-config.example.json build-config.json')
    console.log('  # Edit build-config.json with your settings')
    process.exit(1)
  }

  log.success('Loading configuration from build-config.json')
  const config: BuildConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))

  // Load SSH key from file if specified
  if (config.sshKeyFile && existsSync(config.sshKeyFile)) {
    config.sshKeyContent = readFileSync(config.sshKeyFile, 'utf-8').trim()
  } else if (config.sshKeyFile) {
    // Try relative to home
    const expandedPath = config.sshKeyFile.replace('~', process.env.HOME || '')
    if (existsSync(expandedPath)) {
      config.sshKeyContent = readFileSync(expandedPath, 'utf-8').trim()
    }
  }

  return config
}

function printSummary(config: BuildConfig) {
  console.log(
    `\n${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}`,
  )
  console.log(`${colors.yellow}Build Configuration Summary${colors.reset}`)
  console.log(
    `${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}`,
  )
  console.log(`  Server URL:  ${config.serverUrl}`)
  console.log(
    `  SSH Key:     ${config.sshKeyContent ? 'Configured' : 'Not configured'}`,
  )
  console.log(`  Timezone:    ${config.timezone}`)
  console.log(
    `  WiFi:        ${config.wifi ? config.wifi.ssid : 'Not configured'}`,
  )
  console.log(`  Output:      ${OUTPUT_DIR}/musicbox.img`)
  console.log(
    `${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}\n`,
  )
}

// ============================================
// Build Steps
// ============================================

function setupPigen(forceClean = false) {
  log.header('Setting up pi-gen')

  console.log(`Build directory: ${BUILD_DIR}`)

  // Force clean if requested or if work directory has wrong architecture
  if (forceClean && existsSync(PIGEN_DIR)) {
    console.log('Removing existing pi-gen for fresh clone...')
    rmSync(PIGEN_DIR, { recursive: true })
  }

  if (!existsSync(PIGEN_DIR)) {
    console.log('Cloning pi-gen (bookworm-arm64 branch)...')
    mkdirSync(BUILD_DIR, { recursive: true })
    // Use the bookworm-arm64 branch which has correct GPG keys for bookworm
    exec(
      `git clone --depth 1 --branch bookworm-arm64 https://github.com/RPi-Distro/pi-gen.git "${PIGEN_DIR}"`,
    )
    log.success('pi-gen cloned (bookworm-arm64 branch)')
  } else {
    log.success('pi-gen already cloned (use --clean to force fresh clone)')
  }
}

function configureBuild(config: BuildConfig) {
  log.header('Configuring Build')

  const imgName = 'musicbox'

  // Create pi-gen config
  // Use arm64 architecture to avoid setarch issues on macOS Docker
  // Password hash for "musicbox" - change after first login
  // Escape $ signs for shell config file
  const passwordHash = '\\$6\\$I67bRC76P3aboGhe\\$pwAdiO0jkDBTo3RaeVsuDEa9YvK12msDoGOM.LRanNPqMepP2h7S6ou6EmoRj838UITAIYW447BmjKh7SSmNB.'
  const pigenConfig = `IMG_NAME="${imgName}"
RELEASE="bookworm"
TARGET_HOSTNAME="musicbox"
KEYBOARD_KEYMAP="us"
KEYBOARD_LAYOUT="English (US)"
TIMEZONE_DEFAULT="${config.timezone}"
FIRST_USER_NAME="musicbox"
FIRST_USER_PASS="${passwordHash}"
ENABLE_SSH=1
LOCALE_DEFAULT="en_US.UTF-8"
STAGE_LIST="stage0 stage1 stage2 stage-musicbox"
DEPLOY_COMPRESSION="none"
ARCH="arm64"
`
  writeFileSync(join(PIGEN_DIR, 'config'), pigenConfig)

  // Copy custom stage
  const stageSource = join(__dirname, 'pi-gen-config/stage-musicbox')
  const stageDest = join(PIGEN_DIR, 'stage-musicbox')
  if (existsSync(stageDest)) {
    rmSync(stageDest, { recursive: true })
  }
  cpSync(stageSource, stageDest, { recursive: true })

  // Configure SSH key
  const authorizedKeysPath = join(
    stageDest,
    '01-configure-system/files/authorized_keys',
  )
  if (config.sshKeyContent) {
    writeFileSync(authorizedKeysPath, config.sshKeyContent + '\n')
    log.success('SSH key configured')
  } else {
    writeFileSync(authorizedKeysPath, '# No SSH key configured\n')
  }

  // Configure server URL
  const bootstrapConfigPath = join(
    stageDest,
    '02-install-bootstrap/files/config.txt',
  )
  writeFileSync(
    bootstrapConfigPath,
    `# MusicBox Bootstrap Configuration\nSERVER_URL=${config.serverUrl}\n`,
  )

  // Configure WiFi
  const wifiConfigPath = join(
    stageDest,
    '03-install-services/files/wifi-config.txt',
  )
  if (config.wifi) {
    writeFileSync(
      wifiConfigPath,
      `SSID="${config.wifi.ssid}"\nPASSWORD="${config.wifi.password}"\nCOUNTRY="${config.wifi.country}"\n`,
    )
    log.success('WiFi credentials embedded')
  } else if (existsSync(wifiConfigPath)) {
    rmSync(wifiConfigPath)
  }

  // Make scripts executable
  exec(`find "${stageDest}" -name "*.sh" -exec chmod +x {} \\;`)

  // Skip stages we don't need
  for (const stage of ['stage3', 'stage4', 'stage5']) {
    const skipPath = join(PIGEN_DIR, stage, 'SKIP')
    const skipImagesPath = join(PIGEN_DIR, stage, 'SKIP_IMAGES')
    writeFileSync(skipPath, '')
    writeFileSync(skipImagesPath, '')
  }
}

function setupArmEmulation() {
  log.header('Setting up ARM emulation')
  console.log('Registering QEMU handlers for ARM emulation...')
  try {
    exec('docker run --rm --privileged tonistiigi/binfmt --install arm,arm64', {
      silent: true,
    })
    log.success('ARM emulation configured')
  } catch {
    log.warning('Could not configure ARM emulation (may already be set up)')
  }
}

function cleanupPreviousBuild() {
  log.header('Cleaning up previous build')

  // Remove existing pi-gen container if it exists
  try {
    const result = execSilent(
      "docker ps -a --filter name=pigen_work --format '{{.Names}}'",
    )
    if (result.includes('pigen_work')) {
      console.log('Removing existing pigen_work container...')
      exec('docker rm -v pigen_work', { silent: true })
      log.success('Previous container removed')
    } else {
      console.log('No previous container found')
    }
  } catch {
    // Container doesn't exist, that's fine
  }

  // Clean work directory to ensure fresh build with new architecture
  const workDir = join(PIGEN_DIR, 'work')
  if (existsSync(workDir)) {
    console.log('Cleaning pi-gen work directory...')
    rmSync(workDir, { recursive: true })
    log.success('Work directory cleaned')
  }

  // Remove cached Docker image to force rebuild with new config
  try {
    const imageResult = execSilent("docker images pi-gen --format '{{.ID}}'")
    if (imageResult) {
      console.log('Removing cached pi-gen Docker image...')
      exec('docker rmi pi-gen', { silent: true })
      log.success('Docker image removed')
    }
  } catch {
    // Image doesn't exist, that's fine
  }
}

function buildDockerImage() {
  log.header('Building Docker image')
  console.log(
    'Building pi-gen Docker image with fresh packages (this may take a few minutes)...\n',
  )

  // Build with --no-cache to ensure fresh debian-archive-keyring
  exec(`docker build --no-cache -t pi-gen "${PIGEN_DIR}"`, { cwd: PIGEN_DIR })
  log.success('Docker image built')
}

async function runBuild(): Promise<boolean> {
  log.header('Starting Docker build')
  console.log('This will take 30-60 minutes...\n')

  return new Promise((resolve) => {
    // Pass ARCH=arm64 as environment variable to avoid setarch linux32 issues on macOS
    // Add PIGEN_DOCKER_OPTS for better device access on OrbStack/Docker Desktop
    const build = spawn('./build-docker.sh', [], {
      cwd: PIGEN_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        ARCH: 'arm64',
        PIGEN_DOCKER_OPTS: '--cap-add=SYS_ADMIN --device=/dev/fuse',
      },
    })

    build.on('close', (code) => {
      resolve(code === 0)
    })
  })
}

function copyOutput(): string | null {
  log.header('Copying output image')

  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Remove existing output image to prevent issues
  const existingImage = join(OUTPUT_DIR, 'musicbox.img')
  if (existsSync(existingImage)) {
    console.log('Removing existing output image...')
    unlinkSync(existingImage)
  }

  const deployDir = join(PIGEN_DIR, 'deploy')
  if (!existsSync(deployDir)) {
    log.error('Deploy directory not found')
    return null
  }

  // Find the built image
  const files = readdirSync(deployDir)
  let imgFile = files.find((f) => f.endsWith('.img'))

  if (!imgFile) {
    // Check for compressed
    const xzFile = files.find((f) => f.endsWith('.img.xz'))
    if (xzFile) {
      console.log('Decompressing image...')
      exec(`xz -dk "${join(deployDir, xzFile)}"`)
      imgFile = xzFile.replace('.xz', '')
    }
  }

  if (!imgFile) {
    log.error('Could not find built image')
    console.log(`Check ${deployDir} for the image`)
    return null
  }

  const sourcePath = join(deployDir, imgFile)
  const destPath = join(OUTPUT_DIR, 'musicbox.img')
  copyFileSync(sourcePath, destPath)

  const stats = statSync(destPath)
  const sizeInMB = Math.round(stats.size / 1024 / 1024)

  log.success(`Image copied to: ${destPath} (${sizeInMB} MB)`)
  return destPath
}

function printFlashInstructions(imagePath: string) {
  console.log(`
${colors.green}╔═══════════════════════════════════════════════════════════╗
║                    BUILD COMPLETE!                        ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

Image: ${colors.yellow}${imagePath}${colors.reset}

${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}
${colors.yellow}Flashing to SD Card${colors.reset}
${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}

1. Insert your SD card and find the device:

   ${colors.yellow}macOS:${colors.reset}
   diskutil list
   # Look for your SD card (e.g., /dev/disk2)

   ${colors.yellow}Linux:${colors.reset}
   lsblk
   # Look for your SD card (e.g., /dev/sdb)

${colors.red}⚠️  WARNING: Double-check the device! Wrong device = data loss${colors.reset}

2. Unmount the SD card:

   ${colors.yellow}macOS:${colors.reset}
   diskutil unmountDisk /dev/diskN

   ${colors.yellow}Linux:${colors.reset}
   sudo umount /dev/sdX*

3. Flash the image:

   ${colors.yellow}macOS:${colors.reset}
   sudo dd if=${imagePath} of=/dev/rdiskN bs=4M status=progress

   ${colors.yellow}Linux:${colors.reset}
   sudo dd if=${imagePath} of=/dev/sdX bs=4M status=progress

4. Eject and insert into Raspberry Pi

${colors.green}Happy building! 🎵${colors.reset}
`)
}

// ============================================
// Main
// ============================================

async function main() {
  const args = process.argv.slice(2)
  const forceInteractive = args.includes('--interactive') || args.includes('-i')
  const forceClean = args.includes('--clean') || args.includes('-c')
  const configExists = existsSync(CONFIG_FILE)

  console.log(`${colors.blue}
╔═══════════════════════════════════════════════════════════╗
║           MusicBox Image Builder                          ║
║   Build a ready-to-flash Raspberry Pi image               ║
╚═══════════════════════════════════════════════════════════╝
${colors.reset}`)

  // Check Docker
  if (!checkDocker()) {
    log.error('Docker is not running')
    console.log('Please start Docker Desktop and try again.')
    process.exit(1)
  }
  log.success('Docker is available')
  console.log()

  // Get configuration - use config file if it exists (unless --interactive)
  let config: BuildConfig
  const useConfig = configExists && !forceInteractive

  if (useConfig) {
    config = loadConfigFromFile()
  } else {
    config = await gatherConfigInteractively()
  }

  // Print summary
  printSummary(config)

  // Confirm (unless using config file)
  if (!useConfig) {
    const proceed = await promptYesNo('Proceed with build?', true)
    if (!proceed) {
      console.log('Build cancelled')
      process.exit(0)
    }
    console.log()
  }

  // Build steps
  setupPigen(forceClean)
  console.log()

  configureBuild(config)
  console.log()

  setupArmEmulation()
  console.log()

  cleanupPreviousBuild()
  console.log()

  buildDockerImage()
  console.log()

  const success = await runBuild()
  if (!success) {
    log.error('Build failed')
    process.exit(1)
  }
  console.log()

  const imagePath = copyOutput()
  if (!imagePath) {
    log.error('Failed to copy output image')
    process.exit(1)
  }

  printFlashInstructions(imagePath)
}

main().catch((err) => {
  log.error(err.message)
  process.exit(1)
})
