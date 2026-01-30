import { createServer } from 'node:http'
import { openAPIRouteHandler } from 'hono-openapi'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { refreshAllFeeds } from './services/podcastService.js'

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

// WebSocket servers for devices and control plane
const deviceWss = new WebSocketServer({ noServer: true })
const controlWss = new WebSocketServer({ noServer: true })

// Device WebSocket - receives events from ESP32 devices
deviceWss.on('connection', (ws) => {
  console.log('[WS:Device] Client connected')

  ws.on('message', (data) => {
    const message = data.toString()
    console.log('[WS:Device] Received:', message)

    try {
      const event = JSON.parse(message)

      // Forward card_scanned events to all control plane clients
      if (event.type === 'card_scanned') {
        const payload = JSON.stringify({
          type: 'card_scanned',
          uid: event.uid,
          timestamp: Date.now(),
        })
        controlWss.clients.forEach((client) => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(payload)
          }
        })
      }
    } catch {
      console.log('[WS:Device] Non-JSON message:', message)
    }
  })

  ws.on('close', () => {
    console.log('[WS:Device] Client disconnected')
  })
})

// Control plane WebSocket - sends events to web UI
controlWss.on('connection', (ws) => {
  console.log('[WS:Control] Client connected')

  ws.on('close', () => {
    console.log('[WS:Control] Client disconnected')
  })
})

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/device') {
    deviceWss.handleUpgrade(req, socket, head, (ws) => {
      deviceWss.emit('connection', ws, req)
    })
  } else if (req.url === '/ws/control') {
    controlWss.handleUpgrade(req, socket, head, (ws) => {
      controlWss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

const PORT = 3001
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
  console.log(`Device WebSocket: ws://localhost:${PORT}/ws/device`)
  console.log(`Control WebSocket: ws://localhost:${PORT}/ws/control`)

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
