#!/usr/bin/env tsx
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

const deviceName = process.env.DEVICE_NAME || 'dev-player'
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
        deviceId: deviceName,
        nfcId: nfcId,
      }),
    })

    if (response.ok) {
      const result = await response.json()
      console.log(`✅ Scan sent: ${nfcId}`)
      return true
    } else {
      const errorText = await response.text()
      console.error(`❌ Failed to send scan: ${response.status} - ${errorText}`)
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
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()
  )
  return bytes.join(':')
}

async function startScanMode() {
  console.log('🎵 MusicBox NFC Scanner')
  console.log('━'.repeat(50))
  console.log(`📡 Device: ${deviceName}`)
  console.log(`🖥️  Server: ${serverUrl}`)
  console.log('━'.repeat(50))
  console.log('')
  console.log('📻 Scanner is ready!')
  console.log('   Press ENTER to simulate NFC tap')
  console.log('   Press Ctrl+C to exit')
  console.log('')

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
      const success = await sendNFCScan(cardId)
      if (success) {
        console.log(`   Card ID: ${cardId}`)
      }
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
