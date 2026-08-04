import mqtt, { MqttClient } from 'mqtt'
import { EventEmitter } from 'node:events'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices, cards, media, playlistMedia } from '../db/schema.js'
import { getLatestEpisode } from './podcastService.js'
import { resolveSkip } from '../lib/skip.js'

// MQTT Topics
export const TOPICS = {
  // Device registration
  REGISTER: 'musicbox/register',

  // Device-specific topics (use with MAC address)
  deviceEvents: (mac: string) => `musicbox/devices/${mac}/events`,
  deviceCommands: (mac: string) => `musicbox/devices/${mac}/commands`,
  deviceStatus: (mac: string) => `musicbox/devices/${mac}/status`,
}

// Event types from devices
export interface DeviceRegistration {
  mac: string
  firmwareVersion: string
  ip: string
}

export interface CardScannedEvent {
  type: 'card_scanned'
  uid: string
  timestamp: number
}

export interface PlaybackStatusEvent {
  type: 'playback_status'
  status: 'playing' | 'paused' | 'stopped' | 'finished'
  mediaId?: number
  position?: number
}

export interface DeviceStatusEvent {
  type: 'status'
  online: boolean
  mac: string
}

/**
 * A physical next/previous press. The device resolves nothing itself — it
 * reports the press and the elapsed position, and the server answers with a
 * fresh play. Elapsed matters because "previous" means restart-this-track once
 * you're far enough in (§3.6).
 */
export interface SkipEvent {
  type: 'skip'
  direction: 'next' | 'previous'
  /** Seconds into the current track. */
  elapsed?: number
}

export interface DeviceLogsEvent {
  type: 'device_logs'
  logs: string
  timestamp: number
}

export type DeviceEvent =
  | CardScannedEvent
  | PlaybackStatusEvent
  | DeviceStatusEvent
  | SkipEvent
  | DeviceLogsEvent

// Commands to devices

/**
 * Play a URL. That URL is either a single media item or a whole playlist
 * served as one continuous stream — the device treats both identically, as one
 * connection. `mediaId` identifies the first track so the device has something
 * to report before any ICY metadata arrives.
 */
export interface PlayCommand {
  command: 'play'
  url: string
  mediaId: number
}

export interface PauseCommand {
  command: 'pause'
}

export interface ResumeCommand {
  command: 'resume'
}

export interface StopCommand {
  command: 'stop'
}

export interface VolumeCommand {
  command: 'volume'
  level: number // 0-42
}

export interface OtaCommand {
  command: 'ota'
  url: string
  version: string
  sha256: string
}

/**
 * Push the device's sound machine configuration so it can store it locally and
 * act on a long-press without asking. A null url means "nothing configured".
 */
export interface SoundMachineConfigCommand {
  command: 'soundmachine_config'
  url: string | null
  name: string | null
  volume: number | null
}

export interface ErrorSoundCommand {
  command: 'error_sound'
}

/** Device configuration. `status: 'approved'` also unlocks NFC scanning. */
export interface ConfigCommand {
  command: 'config'
  status?: 'approved'
  maxVolume?: number
}

export type DeviceCommand =
  | PlayCommand
  | PauseCommand
  | ResumeCommand
  | StopCommand
  | VolumeCommand
  | OtaCommand
  | SoundMachineConfigCommand
  | ErrorSoundCommand
  | ConfigCommand

// Playback status store (in-memory, keyed by MAC with colons)
export interface PlaybackStatus {
  status: 'playing' | 'paused' | 'stopped' | 'finished'
  mediaId?: number
  mediaTitle?: string
  updatedAt: Date
}

/**
 * What the server last told a device to play.
 *
 * `playback_status` reports a mediaId, which identifies a track but not the
 * playlist it came from — the same track can appear in several. Fulfilling a
 * skip needs that context, so it is recorded when the play is issued.
 *
 * In memory only: a server restart loses it, and skip then has nothing to
 * resolve against until the next card scan. That's an accepted limitation —
 * persisting it would mean writing on every play for a feature that recovers
 * on its own the moment someone scans a card.
 */
export interface PlaybackSession {
  playlistId: number | null
  startedAt: Date
}

class MqttService extends EventEmitter {
  private client: MqttClient | null = null
  private connected = false
  private brokerUrl: string
  private playbackStatusStore: Map<string, PlaybackStatus> = new Map()
  private playbackSessions: Map<string, PlaybackSession> = new Map()
  // Live connection state, from the retained status topic. In memory is right:
  // the broker redelivers retained messages on subscribe, so a server restart
  // repopulates this automatically rather than guessing from timestamps.
  private deviceOnline: Map<string, boolean> = new Map()

  constructor() {
    super()
    this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
  }

  // Get playback status for a device (MAC with colons)
  getPlaybackStatus(mac: string): PlaybackStatus | undefined {
    return this.playbackStatusStore.get(mac)
  }

  /**
   * Whether the broker currently believes a device is connected.
   *
   * Undefined means nothing has been heard either way — no retained status,
   * so treat it as unknown rather than assuming either state.
   */
  isDeviceOnline(mac: string): boolean | undefined {
    return this.deviceOnline.get(mac)
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[MQTT] Connecting to ${this.brokerUrl}...`)

      this.client = mqtt.connect(this.brokerUrl, {
        clientId: `musicbox-api-${Date.now()}`,
        clean: true,
        reconnectPeriod: 5000,
      })

      this.client.on('connect', () => {
        console.log('[MQTT] Connected to broker')
        this.connected = true
        this.subscribeToTopics()
        resolve()
      })

      this.client.on('error', (err) => {
        console.error('[MQTT] Connection error:', err)
        if (!this.connected) {
          reject(err)
        }
      })

      this.client.on('reconnect', () => {
        console.log('[MQTT] Reconnecting...')
      })

      this.client.on('close', () => {
        console.log('[MQTT] Connection closed')
        this.connected = false
      })

      this.client.on('message', (topic, payload) => {
        this.handleMessage(topic, payload)
      })
    })
  }

  private subscribeToTopics(): void {
    if (!this.client) return

    // Subscribe to registration topic
    this.client.subscribe(TOPICS.REGISTER, (err) => {
      if (err) {
        console.error('[MQTT] Failed to subscribe to register topic:', err)
      } else {
        console.log('[MQTT] Subscribed to registration topic')
      }
    })

    // Subscribe to all device events
    this.client.subscribe('musicbox/devices/+/events', (err) => {
      if (err) {
        console.error('[MQTT] Failed to subscribe to device events:', err)
      } else {
        console.log('[MQTT] Subscribed to device events')
      }
    })

    // Subscribe to device status (for LWT messages)
    this.client.subscribe('musicbox/devices/+/status', (err) => {
      if (err) {
        console.error('[MQTT] Failed to subscribe to device status:', err)
      } else {
        console.log('[MQTT] Subscribed to device status')
      }
    })
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    try {
      const message = JSON.parse(payload.toString())

      // Handle device registration
      if (topic === TOPICS.REGISTER) {
        await this.handleRegistration(message as DeviceRegistration)
        return
      }

      // Handle device events
      const eventMatch = topic.match(/^musicbox\/devices\/([^/]+)\/events$/)
      if (eventMatch) {
        const mac = eventMatch[1]
        await this.handleDeviceEvent(mac, message as DeviceEvent)
        return
      }

      // Handle device status (online/offline)
      const statusMatch = topic.match(/^musicbox\/devices\/([^/]+)\/status$/)
      if (statusMatch) {
        const mac = statusMatch[1]
        await this.handleDeviceStatus(mac, message)
        return
      }
    } catch (err) {
      console.error('[MQTT] Failed to handle message:', err)
    }
  }

  private async handleRegistration(reg: DeviceRegistration): Promise<void> {
    console.log(`[MQTT] Device registration: ${reg.mac} (firmware: ${reg.firmwareVersion})`)

    // Check if device already exists
    const [existing] = await db
      .select()
      .from(devices)
      .where(eq(devices.mac, reg.mac))
      .limit(1)

    if (existing) {
      // Update existing device
      await db
        .update(devices)
        .set({
          firmwareVersion: reg.firmwareVersion,
          lastIp: reg.ip,
          lastSeen: new Date(),
        })
        .where(eq(devices.mac, reg.mac))

      console.log(`[MQTT] Updated existing device: ${reg.mac}`)

      // If approved, send config
      if (existing.status === 'approved') {
        this.sendDeviceConfig(reg.mac)
      }
    } else {
      // Create new pending device
      const secret = crypto.randomUUID()
      await db.insert(devices).values({
        mac: reg.mac,
        secret,
        firmwareVersion: reg.firmwareVersion,
        lastIp: reg.ip,
        lastSeen: new Date(),
        status: 'pending',
      })

      console.log(`[MQTT] New device registered (pending): ${reg.mac}`)
    }

    // Emit event for WebSocket clients
    this.emit('device:registered', reg)
  }

  private async handleDeviceEvent(macNoColons: string, event: DeviceEvent): Promise<void> {
    console.log(`[MQTT] Device event from ${macNoColons}:`, event)

    // Convert MAC from topic format (no colons) to DB format (with colons)
    const mac = this.macWithColons(macNoColons)

    // Update last seen
    await db
      .update(devices)
      .set({ lastSeen: new Date() })
      .where(eq(devices.mac, mac))

    // Emit event for WebSocket clients
    this.emit('device:event', { mac, event })

    // Handle specific events
    if (event.type === 'card_scanned') {
      this.emit('card:scanned', { mac, uid: event.uid, timestamp: event.timestamp })
      await this.handleCardScanned(macNoColons, event.uid)
    } else if (event.type === 'playback_status') {
      // Look up media title if we have a mediaId
      let mediaTitle: string | undefined
      if (event.mediaId) {
        const [mediaItem] = await db
          .select({ title: media.title })
          .from(media)
          .where(eq(media.id, event.mediaId))
          .limit(1)
        mediaTitle = mediaItem?.title
      }

      // Store playback status
      this.playbackStatusStore.set(mac, {
        status: event.status,
        mediaId: event.mediaId,
        mediaTitle,
        updatedAt: new Date(),
      })

      this.emit('playback:status', { mac, status: event.status, mediaId: event.mediaId, mediaTitle })
    } else if (event.type === 'skip') {
      await this.handleSkip(macNoColons, mac, event)
    } else if (event.type === 'device_logs') {
      this.handleDeviceLogs(mac, event.logs)
    }
  }

  // Convert MAC from topic format (AABBCCDDEEFF) to DB format (AA:BB:CC:DD:EE:FF)
  private macWithColons(mac: string): string {
    return mac.match(/.{2}/g)?.join(':') || mac
  }

  private async handleCardScanned(macNoColons: string, uid: string): Promise<void> {
    console.log(`[MQTT] Looking up card: ${uid}`)

    // Find the card by UID
    const [card] = await db
      .select()
      .from(cards)
      .where(eq(cards.uid, uid))
      .limit(1)

    if (!card) {
      console.log(`[MQTT] Unknown card: ${uid}`)
      // Emit event so Control Plane can prompt for card registration
      this.emit('card:unknown', { mac: this.macWithColons(macNoColons), uid })
      // Tell device to play error sound
      this.sendCommand(macNoColons, { command: 'error_sound' })
      return
    }

    console.log(`[MQTT] Found card: ${card.name || uid}`)

    // Determine what to play based on card mapping (use MAC without colons for topics)
    const macForTopic = macNoColons

    if (card.mediaId) {
      // Direct media mapping
      const [mediaItem] = await db
        .select()
        .from(media)
        .where(eq(media.id, card.mediaId))
        .limit(1)

      if (mediaItem) {
        const url = `${this.getStreamBaseUrl()}/api/media/stream/${mediaItem.id}`
        console.log(`[MQTT] Playing media: ${mediaItem.title}`)
        this.playSingle(macForTopic, this.macWithColons(macNoColons), url, mediaItem.id)

        // Apply volume if set on card
        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }
      }
    } else if (card.playlistId) {
      // A playlist is one continuous stream, not a queue of tracks: the device
      // opens a single connection covering the whole listen, so there is no
      // per-track reconnect and no gap between tracks. Which track is playing
      // arrives in-band as ICY metadata.
      const [firstTrack] = await db
        .select({ mediaId: playlistMedia.mediaId, title: media.title })
        .from(playlistMedia)
        .innerJoin(media, eq(playlistMedia.mediaId, media.id))
        .where(eq(playlistMedia.playlistId, card.playlistId))
        .orderBy(playlistMedia.position)
        .limit(1)

      if (firstTrack) {
        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }

        const url = `${this.getStreamBaseUrl()}/api/playlists/stream/${card.playlistId}`
        console.log(`[MQTT] Playing playlist ${card.playlistId}, starting: ${firstTrack.title}`)
        // mediaId is the first track, so the device can report something
        // before the first metadata block arrives.
        this.playPlaylist(
          macForTopic,
          this.macWithColons(macNoColons),
          card.playlistId,
          url,
          firstTrack.mediaId
        )
      } else {
        console.log(`[MQTT] Playlist ${card.playlistId} is empty`)
        this.sendCommand(macForTopic, { command: 'error_sound' })
      }
    } else if (card.podcastFeedId) {
      // Podcast feed - play this feed's most recent fully-downloaded episode
      const latestEpisode = await getLatestEpisode(card.podcastFeedId)

      if (latestEpisode) {
        const url = `${this.getStreamBaseUrl()}/api/media/stream/${latestEpisode.id}`
        console.log(`[MQTT] Playing podcast episode: ${latestEpisode.title}`)
        this.playSingle(macForTopic, this.macWithColons(macNoColons), url, latestEpisode.id)

        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }
      } else {
        console.log(`[MQTT] No downloaded episode available for feed ${card.podcastFeedId}`)
        this.sendCommand(macForTopic, { command: 'error_sound' })
      }
    } else {
      console.log(`[MQTT] Card ${uid} has no content mapped`)
    }
  }

  private getBaseUrl(): string {
    // Get the API base URL for streaming
    return process.env.API_BASE_URL || 'http://localhost:3001'
  }

  private getStreamBaseUrl(): string {
    return process.env.STREAM_BASE_URL || this.getBaseUrl()
  }

  /**
   * Answer a physical next/previous press.
   *
   * The device holds no queue, so it can't advance on its own: it reports the
   * press and we decide. Which playlist is playing comes from the session
   * recorded when the play was issued; which track, from the last status the
   * device reported (kept current mid-stream by ICY metadata).
   */
  private async handleSkip(
    macNoColons: string,
    macWithColons: string,
    event: SkipEvent
  ): Promise<void> {
    const session = this.playbackSessions.get(macWithColons)

    if (!session?.playlistId) {
      // Either a single item is playing — where there is nothing to skip to —
      // or the server restarted and lost the session. Both recover on the next
      // card scan, so do nothing rather than guess.
      console.log(`[MQTT] Skip from ${macWithColons} with no playlist session, ignoring`)
      return
    }

    const tracks = await db
      .select({ mediaId: playlistMedia.mediaId })
      .from(playlistMedia)
      .where(eq(playlistMedia.playlistId, session.playlistId))
      .orderBy(playlistMedia.position)

    const currentMediaId = this.playbackStatusStore.get(macWithColons)?.mediaId
    const currentIndex = tracks.findIndex((t) => t.mediaId === currentMediaId)

    const outcome = resolveSkip({
      direction: event.direction,
      currentIndex,
      trackCount: tracks.length,
      elapsedSec: event.elapsed ?? 0,
    })

    if (outcome.action === 'none') return

    if (outcome.action === 'stop') {
      console.log(`[MQTT] Skip ran past the end of playlist ${session.playlistId}`)
      this.stop(macNoColons)
      return
    }

    const target = tracks[outcome.index]
    const url = `${this.getStreamBaseUrl()}/api/playlists/stream/${session.playlistId}?from=${outcome.index}`

    console.log(
      `[MQTT] Skip ${event.direction} on playlist ${session.playlistId}: ` +
        `index ${currentIndex} -> ${outcome.index}`
    )
    this.playPlaylist(macNoColons, macWithColons, session.playlistId, url, target.mediaId)
  }

  private async handleDeviceStatus(macNoColons: string, status: { online: boolean }): Promise<void> {
    const mac = this.macWithColons(macNoColons)
    console.log(`[MQTT] Device ${mac} is ${status.online ? 'online' : 'offline'}`)

    this.deviceOnline.set(mac, status.online)

    // Only an online message is proof of life. Refreshing lastSeen on the
    // will message would mean a device's final act — announcing that it is
    // gone — made it look freshly seen, so it would read as online until the
    // staleness window passed, and again after every broker reconnect
    // redelivered that retained message.
    if (status.online) {
      await db
        .update(devices)
        .set({ lastSeen: new Date() })
        .where(eq(devices.mac, mac))
    }

    this.emit('device:status', { mac, online: status.online })
  }

  private handleDeviceLogs(mac: string, logs: string): void {
    // Parse and display logs from device
    // Format: "uptime|level|module|message\nuptime|level|module|message\n..."
    const lines = logs.split('\n').filter(line => line.trim())
    for (const line of lines) {
      const [uptime, level, module, ...msgParts] = line.split('|')
      const msg = msgParts.join('|')
      const levelIcon = level === 'E' ? '🔴' : level === 'W' ? '🟡' : ''
      console.log(`[Device ${mac}] ${levelIcon}[${level}][${module}] ${msg} (uptime: ${uptime}s)`)
    }

    // Emit for WebSocket clients (could be used to display in Control Plane)
    this.emit('device:logs', { mac, logs })
  }

  /**
   * Send an approved device its configuration.
   *
   * There is nothing else to push: cards are resolved per-scan against the
   * database, so devices hold no card mapping to keep in sync.
   */
  private async sendDeviceConfig(macWithColons: string): Promise<void> {
    const macForTopic = macWithColons.replace(/:/g, '')

    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.mac, macWithColons))
      .limit(1)

    this.publish(TOPICS.deviceCommands(macForTopic), {
      command: 'config',
      status: 'approved',
      maxVolume: device?.maxVolume ?? 42,
    })

    await this.pushSoundMachineConfig(macWithColons)
  }

  /**
   * Push the device's sound machine configuration so it can act on a
   * long-press using local state, with no round trip — and so the sound
   * machine keeps working when the server is unreachable.
   */
  async pushSoundMachineConfig(macWithColons: string): Promise<void> {
    const macForTopic = macWithColons.replace(/:/g, '')

    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.mac, macWithColons))
      .limit(1)

    if (!device) return

    const sound = await this.resolveSoundMachineSound(device.soundMachineSound)

    this.sendCommand(macForTopic, {
      command: 'soundmachine_config',
      url: sound ? `${this.getStreamBaseUrl()}/api/media/stream/${sound.id}` : null,
      name: sound?.title ?? null,
      volume: device.soundMachineVolume ?? null,
    })
  }

  /** Resolve a device's configured sound machine media row, if any. */
  private async resolveSoundMachineSound(
    configured: string | null
  ): Promise<{ id: number; title: string } | null> {
    if (!configured) return null

    const soundId = parseInt(configured, 10)
    if (isNaN(soundId)) return null

    const [sound] = await db
      .select({ id: media.id, title: media.title })
      .from(media)
      .where(eq(media.id, soundId))
      .limit(1)

    return sound ?? null
  }

  // Public methods for sending commands

  publish(topic: string, message: object): void {
    if (!this.client || !this.connected) {
      console.error('[MQTT] Cannot publish - not connected')
      return
    }

    this.client.publish(topic, JSON.stringify(message), { qos: 1 })
  }

  sendCommand(mac: string, command: DeviceCommand): void {
    this.publish(TOPICS.deviceCommands(mac), command)
    console.log(`[MQTT] Sent command to ${mac}:`, command)
  }

  play(mac: string, url: string, mediaId: number): void {
    this.sendCommand(mac, { command: 'play', url, mediaId })
  }

  /**
   * Play a playlist stream and remember that we did.
   *
   * The session is what lets a later skip know which playlist to move within —
   * the device only ever reports a mediaId, which doesn't identify one.
   */
  playPlaylist(
    macNoColons: string,
    macWithColons: string,
    playlistId: number,
    url: string,
    firstMediaId: number
  ): void {
    this.playbackSessions.set(macWithColons, { playlistId, startedAt: new Date() })
    this.play(macNoColons, url, firstMediaId)
  }

  /** Play a single item, clearing any playlist session. */
  playSingle(
    macNoColons: string,
    macWithColons: string,
    url: string,
    mediaId: number
  ): void {
    this.playbackSessions.set(macWithColons, { playlistId: null, startedAt: new Date() })
    this.play(macNoColons, url, mediaId)
  }

  pause(mac: string): void {
    this.sendCommand(mac, { command: 'pause' })
  }

  resume(mac: string): void {
    this.sendCommand(mac, { command: 'resume' })
  }

  stop(mac: string): void {
    this.sendCommand(mac, { command: 'stop' })
  }

  setVolume(mac: string, level: number): void {
    this.sendCommand(mac, { command: 'volume', level })
  }

  triggerOta(mac: string, url: string, version: string, sha256: string): void {
    this.sendCommand(mac, { command: 'ota', url, version, sha256 })
  }

  isConnected(): boolean {
    return this.connected
  }
}

// Singleton instance
export const mqttService = new MqttService()
