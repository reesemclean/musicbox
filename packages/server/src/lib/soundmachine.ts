import fs from 'node:fs'
import path from 'node:path'

export interface SoundMachineSound {
  name: string // Display name (filename without extension)
  filename: string // Full filename with extension
}

// Sound machine assets directory - check both dev and production paths
function getAssetsDir(): string {
  // Try production path first (Docker)
  const prodPath = '/app/assets/soundmachine'
  if (fs.existsSync(prodPath)) {
    return prodPath
  }

  // Fall back to development path (relative to package)
  const devPath = path.join(process.cwd(), 'assets', 'soundmachine')
  if (fs.existsSync(devPath)) {
    return devPath
  }

  // Check if we're in the server package directory
  const serverPath = path.join(__dirname, '..', '..', 'assets', 'soundmachine')
  if (fs.existsSync(serverPath)) {
    return serverPath
  }

  return devPath // Return dev path even if it doesn't exist
}

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']

/**
 * Scan the soundmachine assets folder and return available sounds
 */
export function getSoundMachineSounds(): Array<SoundMachineSound> {
  const assetsDir = getAssetsDir()

  if (!fs.existsSync(assetsDir)) {
    console.log(
      `[soundmachine] Assets directory not found: ${assetsDir}`,
    )
    return []
  }

  try {
    const files = fs.readdirSync(assetsDir)
    const sounds: Array<SoundMachineSound> = []

    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (AUDIO_EXTENSIONS.includes(ext)) {
        const name = path.basename(file, ext)
        sounds.push({ name, filename: file })
      }
    }

    // Sort alphabetically by name
    sounds.sort((a, b) => a.name.localeCompare(b.name))

    return sounds
  } catch (error) {
    console.error('[soundmachine] Error scanning assets:', error)
    return []
  }
}

/**
 * Get sound file path by name (without extension)
 */
export function getSoundFilePath(name: string): string | null {
  const sounds = getSoundMachineSounds()
  const sound = sounds.find((s) => s.name === name)

  if (!sound) {
    return null
  }

  return path.join(getAssetsDir(), sound.filename)
}

/**
 * Get sound file info by name
 */
export function getSoundFileInfo(name: string): {
  path: string
  mimeType: string
  size: number
} | null {
  const filePath = getSoundFilePath(name)

  if (!filePath || !fs.existsSync(filePath)) {
    return null
  }

  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
  }

  const stats = fs.statSync(filePath)

  return {
    path: filePath,
    mimeType: mimeTypes[ext] || 'application/octet-stream',
    size: stats.size,
  }
}

/**
 * Check if a sound exists by name
 */
export function soundExists(name: string): boolean {
  const sounds = getSoundMachineSounds()
  return sounds.some((s) => s.name === name)
}

/**
 * Get the first available sound as a fallback
 */
export function getDefaultSound(): SoundMachineSound | null {
  const sounds = getSoundMachineSounds()
  return sounds.length > 0 ? sounds[0] : null
}
