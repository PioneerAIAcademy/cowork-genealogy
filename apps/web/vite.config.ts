import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxy API + WS to the FastAPI control plane so the browser talks to a
// single origin (cookies + WebSocket just work, no CORS dance). In production
// the control plane serves the built app, so the same relative URLs hold.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
      '/auth': 'http://localhost:8000',
      '/familysearch': 'http://localhost:8000',
      '/ws': { target: 'http://localhost:8000', ws: true }
    }
  }
})
