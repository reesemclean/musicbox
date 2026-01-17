/**
 * NFCReaderTrigger - PN532 NFC card reader via I2C using i2c-tools
 *
 * Uses shell commands (i2ctransfer) for I2C communication - no native modules needed.
 * This approach works reliably in NixOS without complex npm native dependencies.
 *
 * Hardware: PN532 NFC/RFID module in I2C mode
 * Connection:
 *   - SDA → GPIO 2 (Pin 3)
 *   - SCL → GPIO 3 (Pin 5)
 *   - VCC → 5V (Pin 4)
 *   - GND → Ground (Pin 6)
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import type { Trigger } from './TriggerInterface.ts'
import type { PlayerCore } from '../core/PlayerCore.ts'

// PN532 I2C address
const PN532_I2C_ADDRESS = 0x24

// PN532 Commands
const PN532_COMMAND_GETFIRMWAREVERSION = 0x02
const PN532_COMMAND_SAMCONFIGURATION = 0x14
const PN532_COMMAND_INLISTPASSIVETARGET = 0x4a

// Frame constants
const PN532_PREAMBLE = 0x00
const PN532_STARTCODE1 = 0x00
const PN532_STARTCODE2 = 0xff
const PN532_POSTAMBLE = 0x00
const PN532_HOSTTOPN532 = 0xd4
const PN532_PN532TOHOST = 0xd5

export class NFCReaderTrigger implements Trigger {
  readonly name = 'nfc'
  private i2cBus: number
  private running = false
  private playerCore?: PlayerCore
  private lastCardId: string | null = null
  private lastCardTime: number = 0
  private readonly debounceMs = 2000 // Don't re-trigger same card within 2 seconds
  private pollInterval?: NodeJS.Timeout

  constructor(i2cBus: number = 1) {
    this.i2cBus = i2cBus
  }

  async start(playerCore: PlayerCore): Promise<void> {
    this.playerCore = playerCore
    this.running = true

    const i2cPath = `/dev/i2c-${this.i2cBus}`

    if (!existsSync(i2cPath)) {
      console.log(`⚠️  NFC Reader: I2C bus not found (${i2cPath})`)
      console.log(`   Ensure I2C is enabled in NixOS configuration`)
      return
    }

    // Check if i2ctransfer is available by trying to run it
    try {
      execSync('i2ctransfer -V', { stdio: 'pipe' })
    } catch {
      console.log(`⚠️  NFC Reader: i2ctransfer not found`)
      console.log(`   Install i2c-tools package`)
      console.log(`   PATH: ${process.env.PATH}`)
      return
    }

    try {
      // Wake up PN532
      await this.wakeup()
      await this.sleep(50)

      // Check firmware version to verify communication
      const firmware = await this.getFirmwareVersion()
      if (firmware) {
        console.log(
          `📡 NFC Reader initialized (PN532 IC:0x${firmware.ic.toString(16)} v${firmware.version}.${firmware.revision})`,
        )
      } else {
        console.log(`⚠️  NFC Reader: Could not read firmware version`)
        console.log(`   Check wiring: SDA→Pin3, SCL→Pin5, VCC→5V, GND→GND`)
        return
      }

      // Configure SAM (Security Access Module)
      const samConfigured = await this.SAMConfig()
      if (!samConfigured) {
        console.log(`⚠️  NFC Reader: SAM configuration failed`)
        return
      }

      console.log(`   Polling for NFC cards...`)

      // Start polling loop
      this.pollInterval = setInterval(() => this.pollForCard(), 300)
    } catch (err) {
      console.log(`⚠️  NFC Reader initialization failed:`, err)
    }
  }

  /**
   * Wake up the PN532 by sending a dummy byte
   */
  private async wakeup(): Promise<void> {
    try {
      // Send wake-up sequence
      execSync(
        `i2ctransfer -y ${this.i2cBus} w1@0x${PN532_I2C_ADDRESS.toString(16)} 0x00`,
        { stdio: 'pipe' },
      )
    } catch {
      // Ignore wakeup errors - PN532 may NAK
    }
    await this.sleep(50)
  }

  /**
   * Get PN532 firmware version
   */
  private async getFirmwareVersion(): Promise<{
    ic: number
    version: number
    revision: number
  } | null> {
    const response = await this.sendCommand(
      PN532_COMMAND_GETFIRMWAREVERSION,
      [],
    )
    if (response && response.length >= 3) {
      return {
        ic: response[0],
        version: response[1],
        revision: response[2],
      }
    }
    return null
  }

  /**
   * Configure SAM (Security Access Module)
   */
  private async SAMConfig(): Promise<boolean> {
    const response = await this.sendCommand(PN532_COMMAND_SAMCONFIGURATION, [
      0x01, // Normal mode
      0x14, // Timeout 50ms * 20 = 1s
      0x01, // Use IRQ pin
    ])
    return response !== null
  }

  /**
   * Poll for NFC card
   */
  private async pollForCard(): Promise<void> {
    if (!this.running) return

    try {
      const response = await this.sendCommand(
        PN532_COMMAND_INLISTPASSIVETARGET,
        [
          0x01, // Max 1 card
          0x00, // 106 kbps type A (ISO14443A)
        ],
      )

      if (response && response.length > 0) {
        const numCards = response[0]

        if (numCards > 0 && response.length >= 6) {
          // Parse response:
          // [0] = number of targets
          // [1] = target number
          // [2,3] = SENS_RES
          // [4] = SEL_RES
          // [5] = NFCID length
          // [6...] = NFCID (UID)
          const uidLength = response[5]

          if (response.length >= 6 + uidLength) {
            const uid = response.slice(6, 6 + uidLength)
            const cardId = uid
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
              .toUpperCase()

            const now = Date.now()
            const timeSinceLastScan = now - this.lastCardTime

            // Only trigger if it's a different card, or same card after debounce period
            if (
              cardId !== this.lastCardId ||
              timeSinceLastScan >= this.debounceMs
            ) {
              this.lastCardId = cardId
              this.lastCardTime = now
              console.log(`\n🎴 NFC Card detected: ${cardId}`)
              await this.playerCore?.handleCardScan(cardId)
            }
          }
        }
        // Don't reset lastCardId when no card - keep it for debounce comparison
      }
    } catch {
      // Polling error - don't reset lastCardId
    }
  }

  /**
   * Send command to PN532 and read response using i2ctransfer
   */
  private async sendCommand(
    command: number,
    data: number[],
  ): Promise<number[] | null> {
    try {
      // Build command frame
      const frame = this.buildFrame(command, data)

      // Convert to hex string for i2ctransfer
      const hexBytes = frame
        .map((b) => `0x${b.toString(16).padStart(2, '0')}`)
        .join(' ')

      // Write command
      execSync(
        `i2ctransfer -y ${this.i2cBus} w${frame.length}@0x${PN532_I2C_ADDRESS.toString(16)} ${hexBytes}`,
        { stdio: 'pipe' },
      )

      // Wait for PN532 to process
      await this.sleep(50)

      // First, read ACK frame (6 bytes: 00 00 FF 00 FF 00)
      // Check if ready for ACK
      let ready = false
      for (let i = 0; i < 10; i++) {
        try {
          const readyResult = execSync(
            `i2ctransfer -y ${this.i2cBus} r1@0x${PN532_I2C_ADDRESS.toString(16)}`,
            { stdio: 'pipe' },
          )
            .toString()
            .trim()

          const readyByte = parseInt(readyResult, 16)
          if (readyByte === 0x01) {
            ready = true
            break
          }
        } catch {
          // Not ready yet
        }
        await this.sleep(10)
      }

      if (!ready) {
        return null
      }

      // Read ACK frame (includes ready byte)
      execSync(
        `i2ctransfer -y ${this.i2cBus} r7@0x${PN532_I2C_ADDRESS.toString(16)}`,
        { stdio: 'pipe' },
      )

      // Wait for response to be ready
      await this.sleep(50)

      ready = false
      for (let i = 0; i < 20; i++) {
        try {
          const readyResult = execSync(
            `i2ctransfer -y ${this.i2cBus} r1@0x${PN532_I2C_ADDRESS.toString(16)}`,
            { stdio: 'pipe' },
          )
            .toString()
            .trim()

          const readyByte = parseInt(readyResult, 16)
          if (readyByte === 0x01) {
            ready = true
            break
          }
        } catch {
          // Not ready yet
        }
        await this.sleep(10)
      }

      if (!ready) {
        return null
      }

      // Read actual response frame
      const result = execSync(
        `i2ctransfer -y ${this.i2cBus} r32@0x${PN532_I2C_ADDRESS.toString(16)}`,
        { stdio: 'pipe' },
      )
        .toString()
        .trim()

      // Parse hex response
      const responseBytes = result
        .split(/\s+/)
        .filter((s) => s.startsWith('0x'))
        .map((s) => parseInt(s, 16))

      return this.parseResponse(responseBytes)
    } catch {
      return null
    }
  }

  /**
   * Build PN532 command frame
   */
  private buildFrame(command: number, data: number[]): number[] {
    const length = data.length + 2 // TFI + command + data
    const frame: number[] = []

    frame.push(PN532_PREAMBLE)
    frame.push(PN532_STARTCODE1)
    frame.push(PN532_STARTCODE2)
    frame.push(length)
    frame.push((~length + 1) & 0xff) // LCS (length checksum)
    frame.push(PN532_HOSTTOPN532) // TFI
    frame.push(command)
    frame.push(...data)

    // Calculate DCS (data checksum)
    let dcs = PN532_HOSTTOPN532 + command
    for (const byte of data) {
      dcs += byte
    }
    frame.push((~dcs + 1) & 0xff)
    frame.push(PN532_POSTAMBLE)

    return frame
  }

  /**
   * Parse PN532 response frame
   */
  private parseResponse(bytes: number[]): number[] | null {
    if (bytes.length < 8) return null

    // Skip ready byte if present
    let offset = 0
    if (bytes[0] === 0x01) {
      offset = 1
    }

    // Check for preamble and start codes
    if (
      bytes[offset] !== PN532_PREAMBLE ||
      bytes[offset + 1] !== PN532_STARTCODE1 ||
      bytes[offset + 2] !== PN532_STARTCODE2
    ) {
      return null
    }

    const dataLength = bytes[offset + 3]

    // Bounds check
    if (bytes.length < offset + 6 + dataLength) {
      return null
    }

    const tfi = bytes[offset + 5]

    // Verify TFI (should be PN532 to host)
    if (tfi !== PN532_PN532TOHOST) {
      return null
    }

    // Extract response data (skip TFI and command response byte)
    const responseData: number[] = []
    for (let i = 0; i < dataLength - 2; i++) {
      responseData.push(bytes[offset + 7 + i])
    }

    return responseData
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async stop(): Promise<void> {
    this.running = false

    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = undefined
    }

    console.log('\n📡 NFC Reader stopped')
  }
}
