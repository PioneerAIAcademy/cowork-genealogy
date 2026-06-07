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
export class WsSessionConnection implements SessionConnection {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private outbox: string[] = []
  private open = false

  constructor(private direct: { wssUrl: string; token: string }) {}

  connect(): void {
    if (this.ws) return
    const url = `${this.direct.wssUrl}/?token=${encodeURIComponent(this.direct.token)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.open = true
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
    this.listeners.clear()
    this.ws?.close()
    this.ws = null
    this.open = false
  }
}
