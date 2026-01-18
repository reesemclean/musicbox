/**
 * Interactive NFC Scan Mode
 *
 * Simulates a Pi device in scanning mode.
 * Press Enter to simulate an NFC card tap.
 * Press Ctrl+C to exit.
 *
 * Usage:
 *   npm run scan-mode
 */

import * as readline from 'readline'
import type { NFCScanResponse, NFCScanErrorResponse } from 'shared'

const deviceSecret = process.env.DEVICE_SECRET || ''
const serverUrl = process.env.SERVER_URL || 'http://localhost:3000'

let scanCount = 0

async function sendNFCScan(nfcId: string) {
  try {
    const response = await fetch(`${serverUrl}/api/nfc/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret: deviceSecret,
        nfcId: nfcId,
      }),
    })

    if (!response.ok && response.status !== 422) {
      console.error(`❌ Failed to scan: ${response.status}`)
      const text = await response.text()
      console.error(`   Error: ${text}`)
      return false
    }

    let result: NFCScanResponse | NFCScanErrorResponse
    try {
      result = (await response.json()) as NFCScanResponse | NFCScanErrorResponse
    } catch {
      console.error(`❌ Invalid response from server`)
      console.error(`   Status: ${response.status}`)
      return false
    }

    if (response.ok && 'success' in result) {
      console.log(`✅ Card registered: ${nfcId}`)
      console.log(`   Type: ${result.contentType}`)

      if (result.content?.type === 'song') {
        const song = result.content.song
        console.log(
          `   🎵 ${song.title}${song.artist ? ` - ${song.artist}` : ''}`,
        )
      } else if (result.content?.type === 'playlist') {
        const playlist = result.content.playlist
        console.log(`   📂 ${playlist.name} (${playlist.songs.length} songs)`)
      } else if (result.content?.type === 'action') {
        console.log(`   ⚡ ${result.content.action.toUpperCase()}`)
      }
      return true
    } else if (response.status === 422) {
      console.log(`⚠️  Card not registered: ${nfcId}`)
      console.log(`   Register at: ${serverUrl}/cards`)
      return false
    } else {
      const errorMsg = 'error' in result ? result.error : 'Unknown error'
      console.error(`❌ Failed to scan: ${response.status} - ${errorMsg}`)
      return false
    }
  } catch (error) {
    console.error('❌ Network error:', error)
    console.error(`   Make sure the server is running at ${serverUrl}`)
    return false
  }
}

function generateCardId(): string {
  // Generate a realistic-looking NFC card ID (like: 04:A3:2F:BA:C1:D2)
  const bytes = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase(),
  )
  return bytes.join(':')
}

async function startScanMode() {
  console.log('🎵 MusicBox NFC Scanner (Dev Mode)')
  console.log('━'.repeat(50))
  console.log(`🖥️  Server: ${serverUrl}`)
  console.log(`🔑 Secret: ${deviceSecret ? '(configured)' : '(not configured - scans will fail)'}`)
  console.log('━'.repeat(50))
  console.log('')
  console.log('📻 Scanner is ready!')
  console.log('   Press ENTER to simulate NFC tap')
  console.log('   Press Ctrl+C to exit')
  console.log('')

  // Create readline interface to handle terminal input
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })

  // Set raw mode to detect single key presses
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  process.stdin.on('data', async (key) => {
    // Check for Ctrl+C (exit)
    if (key[0] === 3) {
      console.log('\n\n👋 Exiting scan mode...')
      process.exit(0)
    }

    // Check for Enter key
    if (key[0] === 13 || key[0] === 10) {
      scanCount++
      const cardId = generateCardId()
      console.log(`\n🔍 Scanning card #${scanCount}...`)
      console.log(`   Card ID: ${cardId}`)
      await sendNFCScan(cardId)
      console.log('\n📻 Ready for next scan (press ENTER)...')
    }
  })

  // Handle cleanup
  process.on('SIGINT', () => {
    console.log('\n\n👋 Exiting scan mode...')
    process.exit(0)
  })
}

startScanMode()
