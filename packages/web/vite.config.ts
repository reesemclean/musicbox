import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'url'

const config = defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  ssr: {
    // mqtt.js has Node-specific code paths that break Vite's SSR bundler
    external: ['mqtt'],
  },
  nitro: {
    // Runs at server start. Without it, startup — including the MQTT
    // connection devices depend on — waits for the first HTTP request.
    plugins: ['./src/nitro/startup.plugin.ts'],
  },
  plugins: [
    devtools(),
    tailwindcss(),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    nitro(),
    viteReact(),
  ],
})

export default config
