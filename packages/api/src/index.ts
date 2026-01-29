import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { WebSocketServer } from 'ws'
import { mediaRoutes } from './routes/media.js'
import { playlistRoutes } from './routes/playlists.js'
import { cardRoutes } from './routes/cards.js'
import { firmwareRoutes } from './routes/firmware.js'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

app.route('/api/media', mediaRoutes)
app.route('/api/playlists', playlistRoutes)
app.route('/api/cards', cardRoutes)
app.route('/api/firmware', firmwareRoutes)

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

// WebSocket server on /ws/device path
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws) => {
  console.log('[WS] Client connected')

  ws.on('message', (data) => {
    const message = data.toString()
    console.log('[WS] Received:', message)

    // Echo back for testing
    ws.send(`echo: ${message}`)
  })

  ws.on('close', () => {
    console.log('[WS] Client disconnected')
  })

  ws.on('error', (err) => {
    console.error('[WS] Error:', err)
  })
})

// Handle WebSocket upgrade requests
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/device') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

const PORT = 3001
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`)
  console.log(`WebSocket available at ws://localhost:${PORT}/ws/device`)
})
