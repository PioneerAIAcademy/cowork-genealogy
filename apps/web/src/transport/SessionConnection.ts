// The client realtime seam. WsSessionConnection (one bidirectional WebSocket
// straight to the in-sandbox WS server) is the only implementation. The viewer
// transport (WsResearchTransport) and ChatPane consume only this interface
// (conn.on / conn.send), so the transport is invisible to them.
export type WsMessage = { type: string; [k: string]: unknown }
export type Listener = (msg: WsMessage) => void

export interface SessionConnection {
  connect(): void
  on(listener: Listener): () => void
  send(obj: WsMessage): void // user_msg / interrupt
  close(): void
}

// One WebSocket for both directions, connected directly to the sandbox's WS
// server at `wssUrl` and authenticated with the per-sandbox handshake `token`
// (?token=…). `wssUrl` is wss://…e2b.app for E2B, ws://127.0.0.1:port for local.
// Reconnect tuning: the in-sandbox WS server can briefly refuse during its
// ~40ms cold-start (and again across a sandbox pause/resume). A single failed
// attempt would hang the turn forever, so retry with backoff until the server
// accepts, capped so a genuinely dead sandbox surfaces an error instead of
// spinning silently.
const MAX_RETRIES = 20
const retryDelayMs = (attempt: number): number => Math.min(1000, 150 * attempt)

export class WsSessionConnection implements SessionConnection {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private outbox: string[] = []
  private open = false
  private closed = false
  private attempts = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private direct: { wssUrl: string; token: string }) {}

  connect(): void {
    if (this.ws || this.closed) return
    const url = `${this.direct.wssUrl}/?token=${encodeURIComponent(this.direct.token)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.open = true
      this.attempts = 0
      for (const m of this.outbox) ws.send(m)
      this.outbox = []
    }
    ws.onmessage = (ev) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      for (const l of [...this.listeners]) l(msg)
    }
    ws.onclose = () => {
      this.open = false
      this.ws = null
      if (this.closed) return
      this.attempts += 1
      if (this.attempts > MAX_RETRIES) {
        for (const l of [...this.listeners])
          l({ type: 'status', state: 'chat_error', message: 'Could not reach the agent (connection failed).' })
        return
      }
      this.retryTimer = setTimeout(() => {
        if (!this.closed) this.connect()
      }, retryDelayMs(this.attempts))
    }
    ws.onerror = () => {
      // A failed connect fires onerror before onclose; close it so the onclose
      // path (above) drives the reconnect and we don't leak a half-open socket.
      try {
        ws.close()
      } catch {
        // already closing
      }
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(obj: WsMessage): void {
    const s = JSON.stringify(obj)
    if (this.ws && this.open) this.ws.send(s)
    else this.outbox.push(s)
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.listeners.clear()
    this.ws?.close()
    this.ws = null
    this.open = false
  }
}
