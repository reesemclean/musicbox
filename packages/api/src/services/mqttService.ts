import mqtt, { MqttClient } from 'mqtt'
import { EventEmitter } from 'node:events'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { devices, cards, media, playlists, playlistMedia, podcastFeeds } from '../db/schema.js'

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
  status: 'playing' | 'paused' | 'stopped'
  mediaId?: number
  position?: number
}

export interface DeviceStatusEvent {
  type: 'status'
  online: boolean
  mac: string
}

export type DeviceEvent = CardScannedEvent | PlaybackStatusEvent | DeviceStatusEvent

// Commands to devices
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
  level: number // 0-21
}

export interface OtaCommand {
  command: 'ota'
  url: string
  version: string
}

export type DeviceCommand = PlayCommand | PauseCommand | ResumeCommand | StopCommand | VolumeCommand | OtaCommand

class MqttService extends EventEmitter {
  private client: MqttClient | null = null
  private connected = false
  private brokerUrl: string

  constructor() {
    super()
    this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
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
        const url = `${this.getBaseUrl()}/api/media/stream/${mediaItem.id}`
        console.log(`[MQTT] Playing media: ${mediaItem.title}`)
        this.play(macForTopic, url, mediaItem.id)

        // Apply volume if set on card
        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }
      }
    } else if (card.playlistId) {
      // Playlist mapping - play first track
      const [firstTrack] = await db
        .select({
          mediaId: playlistMedia.mediaId,
          position: playlistMedia.position,
          title: media.title,
        })
        .from(playlistMedia)
        .innerJoin(media, eq(playlistMedia.mediaId, media.id))
        .where(eq(playlistMedia.playlistId, card.playlistId))
        .orderBy(playlistMedia.position)
        .limit(1)

      if (firstTrack) {
        const url = `${this.getBaseUrl()}/api/media/stream/${firstTrack.mediaId}`
        console.log(`[MQTT] Playing playlist, first track: ${firstTrack.title}`)
        this.play(macForTopic, url, firstTrack.mediaId)

        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }
      }
    } else if (card.podcastFeedId) {
      // Podcast feed - play most recent episode
      const [latestEpisode] = await db
        .select()
        .from(media)
        .where(eq(media.type, 'podcast'))
        .orderBy(desc(media.createdAt))
        .limit(1)

      // TODO: Filter by feedId when we have proper podcast episode → feed linking
      if (latestEpisode) {
        const url = `${this.getBaseUrl()}/api/media/stream/${latestEpisode.id}`
        console.log(`[MQTT] Playing podcast episode: ${latestEpisode.title}`)
        this.play(macForTopic, url, latestEpisode.id)

        if (card.volume !== null) {
          this.setVolume(macForTopic, card.volume)
        }
      }
    } else {
      console.log(`[MQTT] Card ${uid} has no content mapped`)
    }
  }

  private getBaseUrl(): string {
    // Get the API base URL for streaming
    return process.env.API_BASE_URL || 'http://localhost:3001'
  }

  private async handleDeviceStatus(macNoColons: string, status: { online: boolean }): Promise<void> {
    const mac = this.macWithColons(macNoColons)
    console.log(`[MQTT] Device ${mac} is ${status.online ? 'online' : 'offline'}`)

    if (!status.online) {
      // Device went offline (LWT message)
      await db
        .update(devices)
        .set({ lastSeen: new Date() })
        .where(eq(devices.mac, mac))
    }

    this.emit('device:status', { mac, online: status.online })
  }

  private sendDeviceConfig(macWithColons: string): void {
    // Send initial config to approved device
    // Topics use MAC without colons
    const macForTopic = macWithColons.replace(/:/g, '')
    this.publish(TOPICS.deviceCommands(macForTopic), {
      command: 'config',
      status: 'approved',
    })
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

  triggerOta(mac: string, url: string, version: string): void {
    this.sendCommand(mac, { command: 'ota', url, version })
  }

  isConnected(): boolean {
    return this.connected
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.endAsync()
      this.client = null
      this.connected = false
    }
  }
}

// Singleton instance
export const mqttService = new MqttService()
