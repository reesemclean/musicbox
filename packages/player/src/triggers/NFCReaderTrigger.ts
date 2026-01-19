/**
 * NFCReaderTrigger - PN532 NFC card reader via I2C using native i2c-bus
 *
 * Uses the i2c-bus npm package for direct I2C communication without spawning processes.
 * This provides much better CPU efficiency on resource-constrained devices like Pi Zero W 2.
 *
 * Hardware: PN532 NFC/RFID module in I2C mode
 * Connection:
 *   - SDA → GPIO 2 (Pin 3)
 *   - SCL → GPIO 3 (Pin 5)
 *   - VCC → 5V (Pin 4)
 *   - GND → Ground (Pin 6)
 */

import { existsSync } from 'fs'
import type { I2CBus } from 'i2c-bus'
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
  private i2cBusNumber: number
  private bus: I2CBus | null = null
  private running = false
  private playerCore?: PlayerCore
  private lastCardId: string | null = null
  private lastCardTime: number = 0
  private readonly debounceMs = 2000 // Don't re-trigger same card within 2 seconds
  private pollInterval?: NodeJS.Timeout

  constructor(i2cBusNumber: number = 1) {
    this.i2cBusNumber = i2cBusNumber
  }

  async start(playerCore: PlayerCore): Promise<void> {
    this.playerCore = playerCore
    this.running = true

    const i2cPath = `/dev/i2c-${this.i2cBusNumber}`

    if (!existsSync(i2cPath)) {
      console.log(`⚠️  NFC Reader: I2C bus not found (${i2cPath})`)
      console.log(`   Ensure I2C is enabled in NixOS configuration`)
      return
    }

    // Try to load i2c-bus module
    let i2c: typeof import('i2c-bus')
    try {
      i2c = await import('i2c-bus')
    } catch {
      console.log(`⚠️  NFC Reader: i2c-bus module not found`)
      console.log(`   Run: npm install i2c-bus`)
      return
    }

    try {
      // Open I2C bus
      this.bus = i2c.openSync(this.i2cBusNumber)

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
        this.closeBus()
        return
      }

      // Configure SAM (Security Access Module)
      const samConfigured = await this.SAMConfig()
      if (!samConfigured) {
        console.log(`⚠️  NFC Reader: SAM configuration failed`)
        this.closeBus()
        return
      }

      console.log(`   Polling for NFC cards...`)

      // Start polling loop
      this.pollInterval = setInterval(() => this.pollForCard(), 300)
    } catch (err) {
      console.log(`⚠️  NFC Reader initialization failed:`, err)
      this.closeBus()
    }
  }

  /**
   * Close I2C bus if open
   */
  private closeBus(): void {
    if (this.bus) {
      try {
        this.bus.closeSync()
      } catch {
        // Ignore close errors
      }
      this.bus = null
    }
  }

  /**
   * Wake up the PN532 by sending a dummy byte
   */
  private async wakeup(): Promise<void> {
    if (!this.bus) return
    try {
      const wakeupBuffer = Buffer.from([0x00])
      this.bus.i2cWriteSync(PN532_I2C_ADDRESS, 1, wakeupBuffer)
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
    if (!this.running || !this.bus) return

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
   * Send command to PN532 and read response using native I2C
   */
  private async sendCommand(
    command: number,
    data: number[],
  ): Promise<number[] | null> {
    if (!this.bus) return null

    try {
      // Build command frame
      const frame = this.buildFrame(command, data)
      const writeBuffer = Buffer.from(frame)

      // Write command
      this.bus.i2cWriteSync(PN532_I2C_ADDRESS, writeBuffer.length, writeBuffer)

      // Wait for PN532 to process
      await this.sleep(50)

      // Check if ready for ACK (read status byte)
      const statusBuffer = Buffer.alloc(1)
      let ready = false
      for (let i = 0; i < 10; i++) {
        try {
          this.bus.i2cReadSync(PN532_I2C_ADDRESS, 1, statusBuffer)
          if (statusBuffer[0] === 0x01) {
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

      // Read ACK frame (7 bytes including status)
      const ackBuffer = Buffer.alloc(7)
      this.bus.i2cReadSync(PN532_I2C_ADDRESS, 7, ackBuffer)

      // Wait for response to be ready
      await this.sleep(50)

      ready = false
      for (let i = 0; i < 20; i++) {
        try {
          this.bus.i2cReadSync(PN532_I2C_ADDRESS, 1, statusBuffer)
          if (statusBuffer[0] === 0x01) {
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
      const responseBuffer = Buffer.alloc(32)
      this.bus.i2cReadSync(PN532_I2C_ADDRESS, 32, responseBuffer)

      // Convert buffer to array and parse
      const responseBytes = Array.from(responseBuffer)
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

    this.closeBus()

    console.log('\n📡 NFC Reader stopped')
  }
}
