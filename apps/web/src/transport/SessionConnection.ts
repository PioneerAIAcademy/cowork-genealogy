// One WebSocket per active session, shared by the viewer transport (deltas)
// and the chat (agent_event + user_msg). Both attach listeners; SessionView
// owns connect/close. Outbound messages sent before the socket opens are
// queued. This is the client side of the "local_ws" realtime relay; swapping
// to Ably/Pusher would replace this class, nothing else.
export type WsMessage = { type: string; [k: string]: unknown }
type Listener = (msg: WsMessage) => void

export class SessionConnection {
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
