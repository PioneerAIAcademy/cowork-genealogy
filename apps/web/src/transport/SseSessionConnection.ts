import { MAX_RETRIES, retryDelayMs } from './SessionConnection'
import type { Listener, SessionConnection, WsMessage } from './SessionConnection'

// The second SessionConnection: Server-Sent Events from the search-agent prototype's
// web tier (apps/server/proto/web) plus REST for the two client→server messages.
// Selected by VITE_SESSION_TRANSPORT=sse in makeSessionConnection; the hosted alpha
// stays on WsSessionConnection.
//
// Resume is the browser's: every event frame the tier sends carries `id: <seq>`, so
// when the stream drops the EventSource reconnects on its own with `Last-Event-ID`
// and the tier replays exactly what was missed.
//
// Two failure shapes, and they need different ladders. An UNREACHABLE tier leaves
// the EventSource in CONNECTING and the browser retries it forever, firing onerror
// each time — so those errors are counted and after MAX_RETRIES of them without an
// open the stream is closed and chat_error reported. A DETERMINISTIC HTTP failure
// (a 404 for a deleted session, a 400 cursor, a wrong content type) puts it in
// CLOSED and the browser will not retry; a few retries of ours cover a tier that is
// restarting, then the same chat_error. Those retries carry the cursor themselves as
// `?after=<lastSeq>`.
//
// No visibility gate, unlike the WS class: there is no sandbox for a background tab
// to wake, and a hidden tab's reconnect costs the tier one poll.
const MAX_CLOSED_RETRIES = 3
const CLOSED = 2 // EventSource.CLOSED

export class SseSessionConnection implements SessionConnection {
  private es: EventSource | null = null
  private listeners = new Set<Listener>()
  private lastSeq = 0
  // The user_msg echo. ChatPane.send() draws the user's bubble locally and draws
  // another on every user_msg frame (the WS server only ever replays those); the
  // tier streams the row it just wrote, so this connection has to drop exactly that
  // one frame. The tier commits the row BEFORE the queue round trip and the 202, so
  // the frame can arrive before the seq that names it: while a POST is in flight,
  // live user_msg frames are held; the 202's seq discards the matching one (or is
  // remembered if it has not arrived yet) and the rest are relayed.
  private inflight = 0
  private held: WsMessage[] = []
  private ownSeqs = new Set<number>()
  private closed = false
  // Consecutive onerror events without an onopen between them. Reset on open.
  private errors = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private sessionId: string,
    private base = ''
  ) {}

  private url(path: string): string {
    return `${this.base}/api/sessions/${encodeURIComponent(this.sessionId)}${path}`
  }

  private emit(msg: WsMessage): void {
    for (const l of [...this.listeners]) l(msg)
  }

  connect(): void {
    if (this.es || this.closed) return
    const es = new EventSource(this.url(`/events/stream?after=${this.lastSeq}`))
    this.es = es
    es.onopen = () => {
      this.errors = 0
      // Synthetic, client-only, same as the WS class: the open stream IS readiness.
      this.emit({ type: 'conn_state', state: 'open' })
      this.emit({ type: 'status', state: 'chat_ready' })
    }
    es.onmessage = (ev: MessageEvent) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }
      const seq = typeof msg.seq === 'number' ? msg.seq : null
      if (seq !== null) {
        if (seq <= this.lastSeq) return // the reconnect edge: never fold a frame twice
        this.lastSeq = seq
        if (msg.type === 'user_msg') {
          if (this.ownSeqs.delete(seq)) return // the echo, arriving after its 202
          if (this.inflight > 0) {
            this.held.push(msg) // maybe the echo, arriving before its 202
            return
          }
        }
      }
      this.emit(msg)
    }
    es.onerror = () => {
      if (this.closed) return
      this.errors += 1
      this.emit({ type: 'conn_state', state: 'reconnecting' })
      if (es.readyState === CLOSED) {
        // The browser will not retry a deterministic HTTP failure. A few of ours, with
        // the cursor in the URL, cover a tier that is restarting; then give up.
        this.es = null
        if (this.errors > MAX_CLOSED_RETRIES) {
          this.fail('the event stream was refused')
          return
        }
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null
          if (!this.closed) this.connect()
        }, retryDelayMs(this.errors))
      } else if (this.errors > MAX_RETRIES) {
        // CONNECTING: the browser has been retrying on its own, with Last-Event-ID,
        // and none has opened. Stop it rather than spin on "Reconnecting…" forever.
        es.close()
        this.es = null
        this.fail('connection failed')
      }
    }
  }

  private fail(reason: string): void {
    this.emit({ type: 'status', state: 'chat_error', message: `Could not reach the agent (${reason}).` })
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(obj: WsMessage): void {
    if (obj.type === 'user_msg') void this.postMessage(String(obj.text ?? ''))
    else if (obj.type === 'interrupt') void this.postInterrupt()
  }

  private async post(path: string, body?: unknown): Promise<{ ok: boolean; status: number; detail: string; json: unknown }> {
    try {
      const res = await fetch(this.url(path), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      let json: unknown = null
      try {
        json = await res.json()
      } catch {
        /* no body */
      }
      // FastAPI's detail is a string, or an object with a `message` when the route has
      // more to say (the 502 from /messages also names the seq of the row it kept).
      const raw = json && typeof json === 'object' && 'detail' in json ? (json as { detail: unknown }).detail : null
      const detail =
        raw && typeof raw === 'object' && 'message' in raw
          ? String((raw as { message: unknown }).message)
          : raw !== null
            ? String(raw)
            : res.statusText || `HTTP ${res.status}`
      return { ok: res.ok, status: res.status, detail, json }
    } catch (err) {
      return { ok: false, status: 0, detail: String(err), json: null }
    }
  }

  // The 202 body carries `seq`; so does the 502's `detail` — the tier commits the
  // user_msg row before the queue send and keeps it on failure, so there is an echo to
  // drop either way. Anything else (a 404, a network error) named no row.
  private echoSeqOf(r: { ok: boolean; json: unknown }): number | null {
    const body = r.json as { seq?: unknown; detail?: { seq?: unknown } } | null
    const seq = r.ok ? body?.seq : body?.detail?.seq
    return typeof seq === 'number' ? seq : null
  }

  private async postMessage(text: string): Promise<void> {
    this.inflight += 1
    const r = await this.post('/messages', { text })
    this.inflight -= 1
    const seq = this.echoSeqOf(r)
    if (seq !== null) {
      const i = this.held.findIndex((m) => m.seq === seq)
      if (i >= 0) this.held.splice(i, 1)
      else this.ownSeqs.add(seq)
    }
    if (this.inflight === 0 && !this.closed) {
      // Whatever else arrived meanwhile (another tab's message, a replay) relays now.
      const held = this.held
      this.held = []
      for (const m of held) this.emit(m)
    }
    if (r.ok) return
    // The turn was never accepted: end the turn the UI started in send(), so `busy`
    // clears instead of spinning on a turn that has no worker behind it.
    this.emit({ type: 'agent_event', event: { kind: 'error', text: `Could not send your message: ${r.detail}` } })
    this.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
  }

  private async postInterrupt(): Promise<void> {
    const r = await this.post('/interrupt')
    // No turn_done: the turn is still running on the worker; only the request failed.
    if (!r.ok) this.emit({ type: 'agent_event', event: { kind: 'error', text: r.detail } })
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.listeners.clear()
    this.es?.close()
    this.es = null
  }
}
