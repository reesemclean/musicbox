import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  // Vite resolves the `@/*` paths from tsconfig.json natively now; this
  // replaces the vite-tsconfig-paths plugin and the manual alias.
  resolve: {
    tsconfigPaths: true,
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
    nitro(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
