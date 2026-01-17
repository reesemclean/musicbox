/**
 * KeyboardTrigger - Interactive keyboard input for testing and development
 *
 * Provides a readline interface where users can:
 * - Type NFC card IDs to simulate scans
 * - Enter 'status' to see current playback state
 * - Enter 'stop' to stop playback
 * - Press Ctrl+C to exit
 */

import * as readline from 'readline'
import type { Trigger } from './TriggerInterface.ts'
import type { PlayerCore } from '../core/PlayerCore.ts'

export class KeyboardTrigger implements Trigger {
  readonly name = 'keyboard'
  private rl?: readline.Interface
  private playerCore?: PlayerCore
  private isStopping = false

  async start(playerCore: PlayerCore): Promise<void> {
    this.playerCore = playerCore

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '🎴 Card ID: ',
    })

    // Delay showing prompt to let other triggers log their startup messages
    setTimeout(() => {
      console.log('\n📻 Player ready!')
      console.log('   Type NFC card ID and press ENTER to scan')
      console.log("   Type 'status' to see current playback state")
      console.log("   Type 'stop' to stop playback")
      console.log('   Press Ctrl+C to exit\n')
      this.rl?.prompt()
    }, 100)

    this.rl.on('line', async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        this.rl?.prompt()
        return
      }

      if (trimmed.toLowerCase() === 'status') {
        this.printStatus()
        this.rl?.prompt()
        return
      }

      if (trimmed.toLowerCase() === 'stop') {
        this.playerCore?.stop()
        this.rl?.prompt()
        return
      }

      // Don't await - let it run async so Ctrl+C works
      this.playerCore?.handleCardScan(trimmed).finally(() => {
        this.rl?.prompt()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.isStopping) return
    this.isStopping = true

    if (this.rl) {
      this.rl.close()
      this.rl = undefined
    }

    // Force stdin to close
    if (process.stdin.isTTY) {
      process.stdin.pause()
      process.stdin.destroy()
    }
  }

  private async printStatus(): Promise<void> {
    const status = await this.playerCore?.getStatus()
    if (!status) return

    console.log('\n' + '═'.repeat(60))
    if (status.currentSong) {
      console.log(
        `${status.isPlaying ? '▶️  PLAYING' : '⏸️  PAUSED'}: ${status.currentSong.title}`,
      )
      if (status.currentSong.artist) {
        console.log(`   ${status.currentSong.artist}`)
      }
      if (status.playlistPosition) {
        console.log(`   Playlist: ${status.playlistPosition}`)
      }
    } else {
      console.log('⏹️  No song playing')
    }
    console.log('═'.repeat(60))
  }
}
