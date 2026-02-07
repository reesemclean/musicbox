import { createServerFn } from '@tanstack/react-start'

export const getMqttConfig = createServerFn({ method: 'GET' })
  .handler(async () => {
    const wsUrl = process.env.VITE_MQTT_WS_URL || `ws://localhost:9001`
    return { wsUrl }
  })
