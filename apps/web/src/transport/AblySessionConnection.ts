import * as Ably from 'ably'
import { api, type RealtimeTokenResp } from '../api'
import type { Listener, SessionConnection, WsMessage } from './SessionConnection'

// The Ably backend: subscribe to the per-session channel via the Ably JS SDK
// (auth via our /api/realtime/token, so the root key never reaches the browser),
// and send chat input via REST (POST /message). Outbound frames published by the
// control plane arrive as channel messages and are routed to the same listeners
// the WS backend feeds — so ChatPane + WsResearchTransport are unchanged.
export class AblySessionConnection implements SessionConnection {
  private client: Ably.Realtime | null = null
  private channel: Ably.RealtimeChannel | null = null
  private listeners = new Set<Listener>()
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private sessionId: string,
    private tok: RealtimeTokenResp
  ) {}

  connect(): void {
    if (this.client) return
    // Make the session live server-side (resume sandbox + start agent + watch)
    // so the channel is hot before the user types.
    void api.connectSession(this.sessionId).catch(() => {})

    this.client = new Ably.Realtime({
      clientId: this.sessionId,
      // authCallback re-fetches our token endpoint on connect + renewal; the
      // endpoint returns the stringified Ably TokenRequest in `token`.
      authCallback: (_params, callback) => {
        api
          .realtimeToken(this.sessionId)
          .then((t) => callback(null, JSON.parse(t.token!) as Ably.TokenRequest))
          .catch((err) => callback(err as string, null))
      }
    })
    this.channel = this.client.channels.get(this.tok.channel)
    void this.channel.subscribe((msg: Ably.Message) => {
      const data = msg.data as WsMessage
      for (const l of [...this.listeners]) l(data)
    })

    // Heartbeat so the idle-suspend loop keeps the session alive while open.
    this.pingTimer = setInterval(() => void api.pingSession(this.sessionId).catch(() => {}), 30000)
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(obj: WsMessage): void {
    // Chat input goes over REST; the reply streams back over the channel.
    void api.postMessage(this.sessionId, { type: String(obj.type), text: obj.text as string }).catch(
      () => {}
    )
  }

  close(): void {
    this.listeners.clear()
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    this.channel?.detach()
    this.client?.close()
    this.channel = null
    this.client = null
  }
}
