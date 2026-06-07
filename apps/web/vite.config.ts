import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxy API + WS to the FastAPI control plane so the browser talks to a
// single origin (cookies + WebSocket just work, no CORS dance). In production
// the control plane serves the built app, so the same relative URLs hold.
// VITE_API_TARGET overrides the target — e.g. http://127.0.0.1:1837 for real
// Google/FamilySearch OAuth testing (open the app at http://127.0.0.1:5173).
const API = process.env.VITE_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind IPv4 explicitly. `localhost` resolves to ::1 (IPv6) on macOS, so the
    // default bind serves only [::1]:5173 and 127.0.0.1:5173 is unreachable. OAuth
    // needs the browser origin to match the callback host (127.0.0.1:1837), or the
    // session cookie splits across hosts and Google login fails (mismatching_state).
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: true },
      '/auth': { target: API, changeOrigin: true },
      '/familysearch': { target: API, changeOrigin: true },
      '/ws': { target: API, ws: true }
    }
  }
})
