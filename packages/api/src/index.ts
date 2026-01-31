import { createServer } from 'node:http'
import { openAPIRouteHandler } from 'hono-openapi'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { refreshAllFeeds } from './services/podcastService.js'
import { mqttService } from './services/mqttService.js'
import { seedSoundMachineSounds } from './services/seedService.js'

const app = createApp()

// OpenAPI spec
app.get(
  '/openapi.json',
  openAPIRouteHandler(app, {
    documentation: {
      openapi: '3.1.0',
      info: {
        title: 'MusicBox API',
        version: '1.0.0',
        description: 'API for MusicBox NFC music player',
      },
      servers: [{ url: 'http://localhost:3001', description: 'Local development' }],
    },
  })
)

// Create raw HTTP server for WebSocket support
const server = createServer(async (req, res) => {
  // Collect request body
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)

  // Let Hono handle HTTP requests
  const response = await app.fetch(
    new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: ['GET', 'HEAD'].includes(req.method || '') ? undefined : body,
    })
  )

  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  // Handle streaming responses
  if (response.body) {
    const reader = response.body.getReader()
    const push = async () => {
      const { done, value } = await reader.read()
      if (done) {
        res.end()
        return
      }
      res.write(value)
      await push()
    }
    await push()
  } else {
    res.end()
  }
})

// WebSocket server for control plane (web UI)
// Note: Devices now use MQTT instead of WebSocket
const controlWss = new WebSocketServer({ noServer: true })

// Control plane WebSocket - sends events to web UI
controlWss.on('connection', (ws) => {
  console.log('[WS:Control] Client connected')

  ws.on('close', () => {
    console.log('[WS:Control] Client disconnected')
  })
})

// Bridge MQTT events to WebSocket for Control Plane
function broadcastToControlPlane(event: object) {
  const payload = JSON.stringify(event)
  controlWss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(payload)
    }
  })
}

// Forward MQTT events to WebSocket clients
mqttService.on('card:scanned', ({ mac, uid, timestamp }) => {
  broadcastToControlPlane({ type: 'card_scanned', mac, uid, timestamp })
})

mqttService.on('card:unknown', ({ mac, uid }) => {
  broadcastToControlPlane({ type: 'card_unknown', mac, uid })
})

mqttService.on('device:registered', (device) => {
  broadcastToControlPlane({ type: 'device_registered', device })
})

mqttService.on('device:status', ({ mac, online }) => {
  broadcastToControlPlane({ type: 'device_status', mac, online })
})

mqttService.on('device:event', ({ mac, event }) => {
  broadcastToControlPlane({ type: 'device_event', mac, event })
})

mqttService.on('playback:status', ({ mac, status, mediaId, mediaTitle }) => {
  broadcastToControlPlane({ type: 'playback_status', mac, status, mediaId, mediaTitle })
})

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/control') {
    controlWss.handleUpgrade(req, socket, head, (ws) => {
      controlWss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

const PORT = 3001

async function startServer() {
  // Seed sound machine sounds from seed-data directory
  try {
    await seedSoundMachineSounds()
  } catch (err) {
    console.error('[Seed] Failed to seed sound machine sounds:', err)
  }

  // Connect to MQTT broker
  try {
    await mqttService.connect()
  } catch (err) {
    console.error('[MQTT] Failed to connect to broker:', err)
    console.log('[MQTT] Server will continue without MQTT - devices will not be able to connect')
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`)
    console.log(`Control WebSocket: ws://localhost:${PORT}/ws/control`)
    console.log(`MQTT Broker: ${process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'}`)

    // Hourly podcast feed refresh
    const HOUR_MS = 60 * 60 * 1000
    setInterval(async () => {
      console.log('[Podcasts] Running hourly feed refresh...')
      try {
        const result = await refreshAllFeeds()
        console.log(`[Podcasts] Refreshed ${result.succeeded}/${result.total} feeds`)
      } catch (error) {
        console.error('[Podcasts] Hourly refresh failed:', error)
      }
    }, HOUR_MS)
  })
}

startServer()
