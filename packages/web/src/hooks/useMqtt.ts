import { useEffect, useRef, useSyncExternalStore } from 'react'
import mqtt, { type MqttClient } from 'mqtt'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { getMqttConfig } from '@/server/mqtt'

// Event types from devices (matching server-side types)
export interface CardScannedEvent {
  type: 'card_scanned'
  mac: string
  uid: string
  timestamp: number
}

export interface PlaybackStatusEvent {
  type: 'playback_status'
  mac: string
  status: 'playing' | 'paused' | 'stopped' | 'finished'
  mediaId?: number
  mediaTitle?: string
}

export interface DeviceStatusEvent {
  type: 'device_status'
  mac: string
  online: boolean
}

export interface DeviceRegisteredEvent {
  type: 'device_registered'
  mac: string
  firmwareVersion: string
}

export type MqttEvent = CardScannedEvent | PlaybackStatusEvent | DeviceStatusEvent | DeviceRegisteredEvent

type EventListener = (event: MqttEvent) => void
type ConnectionListener = (connected: boolean) => void

// Singleton manager to survive React StrictMode double-renders
class MqttClientManager {
  private static instance: MqttClientManager
  private client: MqttClient | null = null
  private eventListeners = new Set<EventListener>()
  private connectionListeners = new Set<ConnectionListener>()
  private queryClient: QueryClient | null = null
  private _isConnected = false

  static getInstance(): MqttClientManager {
    if (!MqttClientManager.instance) {
      MqttClientManager.instance = new MqttClientManager()
    }
    return MqttClientManager.instance
  }

  setQueryClient(qc: QueryClient) {
    this.queryClient = qc
  }

  connect(wsUrl: string) {
    if (this.client) return

    this.client = mqtt.connect(wsUrl, {
      clientId: `musicbox-web-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    })

    this.client.on('connect', () => {
      console.log('[MQTT] Connected')
      this._isConnected = true
      this.notifyConnectionListeners()

      this.client!.subscribe('musicbox/devices/+/events')
      this.client!.subscribe('musicbox/devices/+/status')
      this.client!.subscribe('musicbox/register')
    })

    this.client.on('message', (topic, payload) => {
      try {
        const message = JSON.parse(payload.toString())
        let event: MqttEvent | null = null

        if (topic === 'musicbox/register') {
          event = {
            type: 'device_registered',
            mac: message.mac,
            firmwareVersion: message.firmwareVersion,
          }
        } else if (topic.match(/^musicbox\/devices\/([^/]+)\/events$/)) {
          const mac = topic.split('/')[2]
          event = { ...message, mac } as MqttEvent
        } else if (topic.match(/^musicbox\/devices\/([^/]+)\/status$/)) {
          const mac = topic.split('/')[2]
          event = { type: 'device_status', mac, online: message.online }
        }

        if (event) {
          if (this.queryClient) {
            if (event.type === 'playback_status' || event.type === 'device_registered' || event.type === 'device_status') {
              this.queryClient.invalidateQueries({ queryKey: ['devices'] })
            } else if (event.type === 'card_scanned') {
              this.queryClient.invalidateQueries({ queryKey: ['cards'] })
            }
          }
          this.eventListeners.forEach((listener) => listener(event))
        }
      } catch (err) {
        console.error('[MQTT] Failed to parse message:', err)
      }
    })

    this.client.on('close', () => {
      this._isConnected = false
      this.notifyConnectionListeners()
    })

    this.client.on('error', (err) => {
      console.error('[MQTT] Error:', err)
    })
  }

  private notifyConnectionListeners() {
    this.connectionListeners.forEach((listener) => listener(this._isConnected))
  }

  addEventListener(listener: EventListener) {
    this.eventListeners.add(listener)
  }

  removeEventListener(listener: EventListener) {
    this.eventListeners.delete(listener)
  }

  subscribeToConnection = (listener: ConnectionListener) => {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  getConnectionSnapshot = () => this._isConnected
}

const mqttManager = MqttClientManager.getInstance()
const getServerSnapshot = () => false

interface UseMqttOptions {
  onEvent?: (event: MqttEvent) => void
  enabled?: boolean
}

export function useMqtt({ onEvent, enabled = true }: UseMqttOptions = {}) {
  const queryClient = useQueryClient()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const isConnected = useSyncExternalStore(
    mqttManager.subscribeToConnection,
    mqttManager.getConnectionSnapshot,
    getServerSnapshot
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !enabled) return

    mqttManager.setQueryClient(queryClient)

    getMqttConfig()
      .then((config) => {
        mqttManager.connect(config.wsUrl)
      })
      .catch(() => {
        mqttManager.connect(`ws://${window.location.hostname}:9001`)
      })

    const listener: EventListener = (event) => {
      onEventRef.current?.(event)
    }
    mqttManager.addEventListener(listener)

    return () => {
      mqttManager.removeEventListener(listener)
    }
  }, [enabled, queryClient])

  return { isConnected }
}
