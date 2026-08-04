import { createServerFn } from '@tanstack/react-start'

/**
 * Where the browser should reach the MQTT broker over WebSocket.
 *
 * Returns null unless explicitly configured. The old default of
 * `ws://localhost:9001` is only ever correct when the browser happens to be
 * running on the server itself — from any other machine "localhost" is that
 * machine, so the connection fails silently and everything that depends on
 * live events (device logs, card-scan toasts) simply never arrives while
 * polled data keeps updating, which makes it look like the devices are at
 * fault. Deriving the host from the page the client already loaded is right
 * far more often than any default we can bake in here.
 */
export const getMqttConfig = createServerFn({ method: 'GET' })
  .handler(async () => {
    return { wsUrl: process.env.VITE_MQTT_WS_URL || null }
  })
