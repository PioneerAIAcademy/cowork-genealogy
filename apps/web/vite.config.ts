import { connect } from 'node:net'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Dev only: tunnel the sandbox WebSocket through THIS origin.
 *
 * A local sandbox listens on its own high port and `/connect` hands the browser
 * `ws://127.0.0.1:<port>`. Every HTTP request the app makes goes through this dev server
 * on :5173 and succeeds; the socket is the one thing that jumps to another port, and some
 * browsers (an ad/privacy extension, a managed policy) block exactly that while leaving
 * the proxied HTTP alone. The symptom is brutal to read: the app loads, the API answers,
 * sign-in works, and only the agent never connects.
 *
 * So the client asks for `ws://<this origin>/sandbox-ws/<port>` instead and we splice it
 * through. Nothing to block: it is the same origin and the same port the page came from.
 *
 * A raw TCP splice rather than a proxy library: an upgrade is just the request head
 * followed by an opaque byte stream, so forwarding the head and piping both ways is the
 * whole job, with no dependency and nothing to misconfigure.
 *
 * The port is validated against the ephemeral range and nothing else is reachable --
 * this listens on 127.0.0.1 only and exists only in `vite dev`, never in a build.
 */
function sandboxWsTunnel(): Plugin {
  return {
    name: 'sandbox-ws-tunnel',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const m = /^\/sandbox-ws\/(\d{4,5})(\?.*)?$/.exec(req.url ?? '')
        if (!m) return
        const port = Number(m[1])
        if (port < 1024 || port > 65535) {
          socket.destroy()
          return
        }
        const upstream = connect(port, '127.0.0.1', () => {
          const head_ = [
            `GET /${m[2] ?? ''} HTTP/1.1`,
            ...Object.entries(req.headers).flatMap(([k, v]) =>
              Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : v === undefined ? [] : [`${k}: ${v}`]
            ),
            '', ''
          ].join('\r\n')
          upstream.write(head_)
          if (head?.length) upstream.write(head)
          socket.pipe(upstream)
          upstream.pipe(socket)
        })
        const bail = (): void => { socket.destroy(); upstream.destroy() }
        upstream.on('error', bail)
        socket.on('error', bail)
      })
    }
  }
}

// Dev: proxy API + WS to the FastAPI control plane so the browser talks to a
// single origin (cookies + WebSocket just work, no CORS dance). In production
// the control plane serves the built app, so the same relative URLs hold.
// VITE_API_TARGET overrides the target — e.g. http://127.0.0.1:1837 for real
// Google/FamilySearch OAuth testing (open the app at http://127.0.0.1:5173).
const API = process.env.VITE_API_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), sandboxWsTunnel()],
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
