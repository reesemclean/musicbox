/**
 * MusicBox Player - Long-running player service
 *
 * Simulates a Pi device that scans NFC cards and plays music.
 * For development: type an NFC card ID and press Enter to simulate a scan.
 *
 * Usage:
 *   npm run player
 */

import * as readline from 'readline'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import type { NFCScanResponse, NFCScanErrorResponse } from 'shared'

const deviceName = process.env.DEVICE_NAME || 'dev-player'
const serverUrl = process.env.SERVER_URL || 'http://localhost:3000'

interface PlayerState {
  currentSong: {
    id: number
    title: string
    artist?: string | null
    streamUrl: string
  } | null
  playlist: Array<{
    id: number
    title: string
    artist?: string | null
  }>
  playlistIndex: number
  isPlaying: boolean
  audioProcess: ChildProcess | null
}

const state: PlayerState = {
  currentSong: null,
  playlist: [],
  playlistIndex: 0,
  isPlaying: false,
  audioProcess: null,
}

function stopAudio(): void {
  if (state.audioProcess) {
    state.audioProcess.kill()
    state.audioProcess = null
  }
}

function playAudio(streamUrl: string, title: string): void {
  stopAudio()

  console.log(`   🔊 Streaming audio...`)

  // Try ffplay first (comes with ffmpeg), fall back to mpg123
  const players = [
    {
      cmd: 'ffplay',
      args: [
        '-nodisp',
        '-autoexit',
        '-loglevel',
        'quiet',
        '-fflags',
        'nobuffer',
        streamUrl,
      ],
    },
    { cmd: 'mpg123', args: ['-q', streamUrl] },
    { cmd: 'afplay', args: [streamUrl] }, // macOS built-in
  ]

  let playerStarted = false

  for (const player of players) {
    try {
      state.audioProcess = spawn(player.cmd, player.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      state.audioProcess.on('error', () => {
        // Try next player
      })

      state.audioProcess.on('exit', (code) => {
        if (state.audioProcess) {
          state.audioProcess = null
          if (code === 0) {
            console.log(`\n✅ Finished playing: ${title}`)
            // Auto-play next song in playlist
            if (state.playlist.length > 0) {
              const nextIndex =
                (state.playlistIndex + 1) % state.playlist.length
              if (nextIndex > state.playlistIndex) {
                state.playlistIndex = nextIndex
                const nextSong = state.playlist[nextIndex]
                state.currentSong = {
                  id: nextSong.id,
                  title: nextSong.title,
                  artist: nextSong.artist,
                  streamUrl: `${serverUrl}/api/stream/${nextSong.id}`,
                }
                console.log(`\n⏭️  Auto-playing next: ${nextSong.title}`)
                playAudio(state.currentSong.streamUrl, state.currentSong.title)
              }
            }
          }
        }
      })

      playerStarted = true
      break
    } catch {
      // Try next player
      continue
    }
  }

  if (!playerStarted) {
    console.log(`   ⚠️  No audio player found (tried ffplay, mpg123, afplay)`)
    console.log(`   Install: brew install ffmpeg  (or mpg123)`)
  }
}

async function scanCard(nfcId: string): Promise<void> {
  try {
    console.log(`\n🔍 Scanning card: ${nfcId}`)

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

    if (!response.ok && response.status !== 422) {
      console.error(`❌ Failed to scan: ${response.status}`)
      const text = await response.text()
      console.error(`   Error: ${text}`)
      return
    }

    let result: NFCScanResponse | NFCScanErrorResponse
    try {
      result = (await response.json()) as NFCScanResponse | NFCScanErrorResponse
    } catch {
      console.error(`❌ Invalid response from server`)
      console.error(`   Status: ${response.status}`)
      return
    }

    if (response.ok && 'success' in result) {
      handleCardContent(result)
    } else if (response.status === 422) {
      console.log(`⚠️  Card not registered: ${nfcId}`)
      console.log(`   Register it at: ${serverUrl}/cards`)
    } else {
      const errorMsg = 'error' in result ? result.error : 'Unknown error'
      console.error(`❌ Failed to scan: ${response.status} - ${errorMsg}`)
    }
  } catch (error) {
    console.error('❌ Network error:', error)
    console.error(`   Make sure the server is running at ${serverUrl}`)
  }
}

function handleCardContent(result: NFCScanResponse): void {
  if (result.content?.type === 'song') {
    const song = result.content.song
    console.log(`🎵 Playing song: ${song.title}`)
    if (song.artist) console.log(`   Artist: ${song.artist}`)
    if (song.album) console.log(`   Album: ${song.album}`)

    state.currentSong = {
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: `${serverUrl}/api/stream/${song.id}`,
    }
    state.playlist = []
    state.playlistIndex = 0
    state.isPlaying = true

    playAudio(state.currentSong.streamUrl, state.currentSong.title)
  } else if (result.content?.type === 'playlist') {
    const playlist = result.content.playlist
    console.log(`📂 Loading playlist: ${playlist.name}`)
    console.log(`   Songs: ${playlist.songs.length}`)

    state.playlist = playlist.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
    }))
    state.playlistIndex = 0

    if (state.playlist.length > 0) {
      const firstSong = state.playlist[0]
      state.currentSong = {
        id: firstSong.id,
        title: firstSong.title,
        artist: firstSong.artist,
        streamUrl: `${serverUrl}/api/stream/${firstSong.id}`,
      }
      state.isPlaying = true

      console.log(`   ▶️  Playing: ${firstSong.title}`)
      if (firstSong.artist) console.log(`      ${firstSong.artist}`)
      playAudio(state.currentSong.streamUrl, state.currentSong.title)
    }
  } else if (result.content?.type === 'action') {
    const action = result.content.action
    console.log(`⚡ Action: ${action.toUpperCase()}`)
    handleAction(action)
  }
}

function handleAction(
  action: 'play' | 'pause' | 'next' | 'previous' | 'stop',
): void {
  switch (action) {
    case 'play':
      if (state.currentSong && !state.isPlaying) {
        state.isPlaying = true
        console.log(`   ▶️  Resumed: ${state.currentSong.title}`)
        playAudio(state.currentSong.streamUrl, state.currentSong.title)
      } else if (state.isPlaying) {
        console.log(`   ⚠️  Already playing`)
      } else {
        console.log(`   ⚠️  No song to play`)
      }
      break

    case 'pause':
      if (state.isPlaying) {
        state.isPlaying = false
        stopAudio()
        console.log(`   ⏸️  Paused`)
      }
      break

    case 'next':
      if (state.playlist.length > 0) {
        state.playlistIndex = (state.playlistIndex + 1) % state.playlist.length
        const nextSong = state.playlist[state.playlistIndex]
        state.currentSong = {
          id: nextSong.id,
          title: nextSong.title,
          artist: nextSong.artist,
          streamUrl: `${serverUrl}/api/stream/${nextSong.id}`,
        }
        state.isPlaying = true
        console.log(`   ⏭️  Next: ${nextSong.title}`)
        playAudio(state.currentSong.streamUrl, state.currentSong.title)
      } else {
        console.log(`   ⚠️  No playlist loaded`)
      }
      break

    case 'previous':
      if (state.playlist.length > 0) {
        state.playlistIndex =
          (state.playlistIndex - 1 + state.playlist.length) %
          state.playlist.length
        const prevSong = state.playlist[state.playlistIndex]
        state.currentSong = {
          id: prevSong.id,
          title: prevSong.title,
          artist: prevSong.artist,
          streamUrl: `${serverUrl}/api/stream/${prevSong.id}`,
        }
        state.isPlaying = true
        console.log(`   ⏮️  Previous: ${prevSong.title}`)
        playAudio(state.currentSong.streamUrl, state.currentSong.title)
      } else {
        console.log(`   ⚠️  No playlist loaded`)
      }
      break

    case 'stop':
      state.isPlaying = false
      stopAudio()
      state.currentSong = null
      state.playlist = []
      state.playlistIndex = 0
      console.log(`   ⏹️  Stopped`)
      break
  }
}

function printStatus(): void {
  console.log('\n' + '═'.repeat(60))
  if (state.currentSong) {
    console.log(
      `${state.isPlaying ? '▶️  PLAYING' : '⏸️  PAUSED'}: ${state.currentSong.title}`,
    )
    if (state.currentSong.artist) {
      console.log(`   ${state.currentSong.artist}`)
    }
    if (state.playlist.length > 0) {
      console.log(
        `   Playlist: ${state.playlistIndex + 1}/${state.playlist.length}`,
      )
    }
  } else {
    console.log('⏹️  No song playing')
  }
  console.log('═'.repeat(60))
}

async function startPlayer() {
  console.log('🎵 MusicBox Player')
  console.log('═'.repeat(60))
  console.log(`📡 Device: ${deviceName}`)
  console.log(`🖥️  Server: ${serverUrl}`)
  console.log('═'.repeat(60))
  console.log('\n📻 Player ready!')
  console.log('   Type NFC card ID and press ENTER to scan')
  console.log("   Type 'status' to see current playback state")
  console.log("   Type 'stop' to stop playback")
  console.log('   Press Ctrl+C to exit\n')

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🎴 Card ID: ',
  })

  rl.prompt()

  rl.on('line', async (input) => {
    const trimmed = input.trim()

    if (!trimmed) {
      rl.prompt()
      return
    }

    if (trimmed.toLowerCase() === 'status') {
      printStatus()
      rl.prompt()
      return
    }

    if (trimmed.toLowerCase() === 'stop') {
      handleAction('stop')
      rl.prompt()
      return
    }

    await scanCard(trimmed)
    rl.prompt()
  })

  rl.on('close', () => {
    stopAudio()
    console.log('\n\n👋 Player stopped')
    process.exit(0)
  })

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    stopAudio()
    console.log('\n\n👋 Player stopped')
    process.exit(0)
  })
}

startPlayer()
