/** Rewrite a LOOPBACK websocket host to match the page's own hostname.
 *
 * The control plane hands back `ws://127.0.0.1:<port>` for a local sandbox. A browser
 * treats `127.0.0.1` and `localhost` as DIFFERENT origins, so a page served from
 * `http://localhost:5173` opening that socket is making a cross-origin WebSocket
 * connection. Chromium with a clean profile allows it; a privacy extension or a stricter
 * browser blocks it — and the failure arrives as a socket that closes without ever
 * reaching the server, which reads as "the agent is down" rather than "your browser
 * refused this".
 *
 * It cost two debugging sessions here: the HTTP requests all work (they go through the
 * dev-server proxy, same-origin), only the socket fails, so the app looks broken while
 * every other signal says healthy.
 *
 * Only loopback hosts are rewritten. A real deployment's `wss://…e2b.app` must be left
 * exactly as issued: pointing a sandbox socket at the page's own hostname there would aim
 * it at the wrong machine entirely.
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0'])

export function sameOriginLoopback(wssUrl: string, pageHostname: string): string {
  if (!wssUrl || !pageHostname) return wssUrl
  let u: URL
  try {
    u = new URL(wssUrl)
  } catch {
    return wssUrl            // not a URL we understand: hand it back untouched
  }
  if (!LOOPBACK.has(u.hostname)) return wssUrl
  if (!LOOPBACK.has(pageHostname)) return wssUrl   // page is not local either; leave it
  if (u.hostname === pageHostname) return wssUrl
  u.hostname = pageHostname
  // `URL` appends a trailing slash to a bare origin; the caller builds `${url}/?token=…`,
  // so returning one here would produce `//?token=` and a 404 on the handshake path.
  return u.toString().replace(/\/$/, '')
}

/** Dev only: route a loopback sandbox socket through THIS origin's dev server.
 *
 * `sameOriginLoopback` above fixes the host; this fixes the PORT, which is the part some
 * browsers block. A local sandbox listens on its own high port, and a browser that is
 * happy with every proxied HTTP request can still refuse a direct `ws://` to a different
 * port -- measured: a clean Chromium opened it fine while the reporter's browser could
 * not, on the same origin, same machine, same sandbox.
 *
 * `/sandbox-ws/<port>` is spliced to `127.0.0.1:<port>` by the `sandbox-ws-tunnel` plugin
 * in vite.config.ts. Same origin, same port as the page, so there is nothing left to
 * block.
 *
 * Returns the input unchanged unless ALL of: we are in dev, the URL is loopback, and it
 * carries an explicit port. A hosted `wss://…e2b.app` is never rewritten -- that would
 * aim the socket at the viewer's own machine.
 */
export function devSandboxTunnel(wssUrl: string, isDev: boolean, pageOrigin: string): string {
  if (!isDev || !wssUrl || !pageOrigin) return wssUrl
  let u: URL
  try {
    u = new URL(wssUrl)
  } catch {
    return wssUrl
  }
  if (u.protocol !== 'ws:') return wssUrl           // never touch wss://
  if (!LOOPBACK.has(u.hostname)) return wssUrl
  if (!u.port) return wssUrl
  let origin: URL
  try {
    origin = new URL(pageOrigin)
  } catch {
    return wssUrl
  }
  const scheme = origin.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${origin.host}/sandbox-ws/${u.port}`
}
