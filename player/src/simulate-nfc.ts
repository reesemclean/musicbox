#!/usr/bin/env tsx
/**
 * NFC Scan Simulator CLI
 *
 * Simulates an NFC card tap from the player device.
 * This sends a scan event to the server which broadcasts it to all connected clients.
 *
 * Usage:
 *   npm run simulate-nfc                    # Random card ID
 *   npm run simulate-nfc 04:A3:2F:BA       # Specific card ID
 */

const deviceName = process.env.DEVICE_NAME || 'dev-player'
const serverUrl = process.env.SERVER_URL || 'http://localhost:3000'

async function simulateNFCScan(nfcId?: string) {
  const cardId = nfcId || `nfc-${Date.now()}`

  console.log('🎯 Simulating NFC card scan...')
  console.log(`   Device: ${deviceName}`)
  console.log(`   Card ID: ${cardId}`)
  console.log(`   Server: ${serverUrl}`)

  try {
    const response = await fetch(`${serverUrl}/api/nfc/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: deviceName,
        nfcId: cardId,
      }),
    })

    if (response.ok) {
      const result = await response.json()
      console.log('✅ NFC scan sent successfully')
      console.log(`   Response: ${result.message}`)
    } else {
      const errorText = await response.text()
      console.error('❌ Failed to send NFC scan')
      console.error(`   Status: ${response.status}`)
      console.error(`   Error: ${errorText}`)
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Network error:', error)
    console.error(`   Make sure the server is running at ${serverUrl}`)
    process.exit(1)
  }
}

// Parse command line arguments
const nfcId = process.argv[2]

// Run the simulation
simulateNFCScan(nfcId)
