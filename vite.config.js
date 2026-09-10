import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = `http://localhost:${process.env.PORT ?? 3001}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // The game state lives in the Node server; Vite just forwards to it.
      // Server sent events stream through this fine as long as we do not buffer.
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
