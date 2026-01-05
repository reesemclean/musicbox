/**
 * NFCReaderTrigger - Hardware NFC card reader integration (STUB)
 *
 * This is a placeholder for future implementation of real NFC hardware.
 *
 * Future implementation will:
 * - Initialize PN532 NFC reader via I2C
 * - Poll for card presence
 * - Read card UID when detected
 * - Call playerCore.handleCardScan(uid)
 * - Wait for card removal before next scan
 *
 * Hardware required:
 * - PN532 NFC/RFID module
 * - I2C connection to Raspberry Pi
 *
 * Library options:
 * - pn532.js (Node.js library for PN532)
 * - node-i2c (Low-level I2C communication)
 */

import type { Trigger } from "./TriggerInterface.ts";
import type { PlayerCore } from "../core/PlayerCore.ts";

export class NFCReaderTrigger implements Trigger {
  readonly name = "nfc";
  private i2cBus: number;

  constructor(i2cBus: number = 1) {
    this.i2cBus = i2cBus;
  }

  async start(playerCore: PlayerCore): Promise<void> {
    console.log("⚠️  NFC Reader trigger not yet implemented");
    console.log("   Hardware required: PN532 NFC/RFID module");
    console.log(`   I2C bus: ${this.i2cBus}`);
    console.log("   Future implementation will use pn532.js library");
    console.log("");
    console.log("   Planned implementation:");
    console.log("   1. Initialize PN532 via I2C");
    console.log("   2. Start polling loop for card presence");
    console.log("   3. Read UID when card detected");
    console.log("   4. Call playerCore.handleCardScan(uid)");
    console.log("   5. Wait for card removal before next scan");
    console.log("");

    // Future implementation would look like:
    //
    // const PN532 = require('pn532');
    // const i2c = require('i2c-bus');
    //
    // const wire = i2c.openSync(this.i2cBus);
    // const pn532 = new PN532(wire);
    //
    // await pn532.SAMConfig();
    //
    // while (true) {
    //   const uid = await pn532.readPassiveTargetID();
    //   if (uid) {
    //     const nfcId = uid.toString('hex').toUpperCase();
    //     await playerCore.handleCardScan(nfcId);
    //     // Wait for card removal
    //     while (await pn532.readPassiveTargetID()) {
    //       await sleep(100);
    //     }
    //   }
    //   await sleep(100);
    // }
  }

  async stop(): Promise<void> {
    // Future: Clean up I2C connection
    console.log("   NFC reader stopped (stub)");
  }
}
