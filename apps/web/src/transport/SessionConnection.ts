// The client realtime seam. Two implementations satisfy this interface:
//  - WsSessionConnection: one bidirectional WebSocket (the local_ws backend).
//  - AblySessionConnection: subscribe via Ably + chat input via REST.
// The viewer transport (WsResearchTransport) and ChatPane consume only this
// interface (conn.on / conn.send), so the backend swap is invisible to them.
export type WsMessage = { type: string; [k: string]: unknown }
export type Listener = (msg: WsMessage) => void

export interface SessionConnection {
  connect(): void
  on(listener: Listener): () => void
  send(obj: WsMessage): void // user_msg / interrupt
  close(): void
}

// ── local_ws backend: one WebSocket for both directions ──────────
export class WsSessionConnection implements SessionConnection {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private outbox: string[] = []
  private open = false

  constructor(private sessionId: string) {}

  connect(): void {
    if (this.ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/sessions/${this.sessionId}`)
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
