/**
 * PlayerCore - Core business logic for the MusicBox player
 *
 * Manages:
 * - Playback operations (play, pause, next, previous, stop)
 * - Card scanning and content handling
 *
 * AudioEngine is the source of truth for playlist and playback state.
 */

import type { Action } from 'shared'
import { AudioEngine } from '../audio/AudioEngine.ts'
import { ServerClient } from '../api/ServerClient.ts'
import type { PlayerStatus } from './types.ts'

export class PlayerCore {
  private audioEngine: AudioEngine
  private serverClient: ServerClient

  constructor(serverClient: ServerClient, audioEngine?: AudioEngine) {
    this.serverClient = serverClient
    this.audioEngine = audioEngine || new AudioEngine()
  }

  /**
   * Initialize the audio engine (mpv + tone generator)
   * Call this early so audio is ready, then call playReadyChime() when fully ready
   */
  async initialize(): Promise<void> {
    await this.audioEngine.initialize()
    await this.audioEngine.initializeTones()
  }

  /**
   * Play the startup chime to indicate player is fully ready
   * Call this after all triggers are initialized
   */
  playReadyChime(): void {
    this.audioEngine.playStartupChime()
    console.log('🎵 Player ready!')
  }

  /**
   * Handle an NFC card scan
   * @param nfcId - The NFC card ID that was scanned
   */
  async handleCardScan(nfcId: string): Promise<void> {
    // Play confirmation beep immediately (don't await - let it play while we fetch)
    this.audioEngine.playCardBeep()

    try {
      console.log(`\n🔍 Scanning card: ${nfcId}`)

      const result = await this.serverClient.scanCard(nfcId)

      if (result.content?.type === 'song') {
        const song = result.content.song
        console.log(`🎵 Playing song: ${song.title}`)
        if (song.artist) console.log(`   Artist: ${song.artist}`)
        if (song.album) console.log(`   Album: ${song.album}`)

        this.loadSong(song)
      } else if (result.content?.type === 'playlist') {
        const playlist = result.content.playlist
        console.log(`📂 Loading playlist: ${playlist.name}`)
        console.log(`   Songs: ${playlist.songs.length}`)

        this.loadPlaylist(playlist)
      } else if (result.content?.type === 'action') {
        const action = result.content.action
        console.log(`⚡ Action: ${action.toUpperCase()}`)
        this.executeAction(action)
      } else if (result.content?.type === 'podcast') {
        const podcast = result.content.podcast
        console.log(`🎙️ Playing podcast: ${podcast.title}`)
        if (podcast.author) console.log(`   Author: ${podcast.author}`)

        this.loadPodcast(podcast)
      } else {
        // Unknown card - play error beep
        console.log(`⚠️  Card not recognized`)
        this.audioEngine.playErrorBeep()
      }
    } catch {
      // Error already logged by ServerClient - play error beep
      this.audioEngine.playErrorBeep()
    }
  }

  /**
   * Load and play a single song
   */
  private loadSong(song: {
    id: number
    title: string
    artist?: string | null
    album?: string | null
  }): void {
    this.audioEngine.play({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id),
    })
  }

  /**
   * Load and play a playlist
   */
  private loadPlaylist(playlist: {
    name: string
    songs: Array<{
      id: number
      title: string
      artist?: string | null
    }>
  }): void {
    const songs = playlist.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      streamUrl: this.serverClient.getStreamUrl(song.id),
    }))

    if (songs.length > 0) {
      console.log(`   ▶️  Playing: ${songs[0].title}`)
      if (songs[0].artist) console.log(`      ${songs[0].artist}`)

      // Load entire playlist into AudioEngine
      this.audioEngine.loadPlaylist(songs)
    }
  }

  /**
   * Load and play the latest episode of a podcast
   */
  private loadPodcast(podcast: {
    id: number
    title: string
    author?: string | null
    latestEpisode: {
      id: number
      title: string
      description?: string | null
      duration?: number | null
    } | null
  }): void {
    if (!podcast.latestEpisode) {
      console.log(`   ⚠️  No episodes available for this podcast`)
      this.audioEngine.playErrorBeep()
      return
    }

    const episode = podcast.latestEpisode
    console.log(`   ▶️  Playing episode: ${episode.title}`)
    if (episode.duration) {
      const minutes = Math.floor(episode.duration / 60)
      console.log(`      Duration: ${minutes} min`)
    }

    // Play the episode using the episode stream URL
    this.audioEngine.play({
      id: episode.id,
      title: episode.title,
      artist: podcast.title, // Use podcast title as "artist"
      streamUrl: this.serverClient.getEpisodeStreamUrl(episode.id),
    })
  }

  /**
   * Execute an action command
   */
  private async executeAction(action: Action): Promise<void> {
    switch (action) {
      case 'play':
        await this.play()
        break
      case 'pause':
        await this.pause()
        break
      case 'next':
        await this.next()
        break
      case 'previous':
        await this.previous()
        break
      case 'stop':
        await this.stop()
        break
    }
  }

  // --- Playback controls (pass-through to AudioEngine) ---

  play(): Promise<void> {
    return this.audioEngine.resume()
  }

  pause(): Promise<void> {
    return this.audioEngine.pause()
  }

  togglePlayPause(): Promise<void> {
    return this.audioEngine.togglePlayPause()
  }

  next(): Promise<void> {
    return this.audioEngine.next()
  }

  previous(): Promise<void> {
    return this.audioEngine.previous()
  }

  stop(): Promise<void> {
    return this.audioEngine.stop()
  }

  getStatus(): Promise<PlayerStatus> {
    return this.audioEngine.getStatus()
  }

  // --- Volume controls ---

  /**
   * Set volume level
   * @param percent - Volume level 0-100
   */
  setVolume(percent: number): void {
    this.audioEngine.setVolume(percent)
  }

  /**
   * Get current volume level
   * @returns Volume percentage 0-100
   */
  getVolume(): number {
    return this.audioEngine.getVolume()
  }

  /**
   * Increase volume
   * @param amount - Amount to increase (default: 10)
   */
  volumeUp(amount?: number): void {
    this.audioEngine.volumeUp(amount)
  }

  /**
   * Decrease volume
   * @param amount - Amount to decrease (default: 10)
   */
  volumeDown(amount?: number): void {
    this.audioEngine.volumeDown(amount)
  }
}
