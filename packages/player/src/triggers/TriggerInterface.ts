/**
 * TriggerInterface - Abstract contract for all input sources
 *
 * Triggers are input sources that can initiate player actions:
 * - Keyboard input (typing card IDs)
 * - HTTP API (remote control)
 * - NFC card reader (hardware)
 * - GPIO buttons (physical controls)
 * - WebSocket events (server push)
 */

import type { PlayerCore } from '../core/PlayerCore.ts'

export interface Trigger {
  /**
   * Unique name for this trigger
   */
  readonly name: string

  /**
   * Start the trigger and connect it to the player core
   * @param playerCore - The player core instance to control
   */
  start(playerCore: PlayerCore): Promise<void>

  /**
   * Stop the trigger and clean up resources
   */
  stop(): Promise<void>
}
