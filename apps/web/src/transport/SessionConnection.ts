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

// Credentials for one WS handshake. Fetched fresh per connect attempt — never
// captured — see the constructor.
export type SessionCredentials = { wssUrl: string; token: string }
export type CredentialsProvider = () => Promise<SessionCredentials>

// One WebSocket for both directions, connected directly to the sandbox's WS
// server at `wssUrl` and authenticated with the per-sandbox handshake `token`
// (?token=…). `wssUrl` is wss://…e2b.app for E2B, ws://127.0.0.1:port for local.
// Reconnect tuning: the in-sandbox WS server can briefly refuse during its
// ~40ms cold-start (and again across a sandbox pause/resume). A single failed
// attempt would hang the turn forever, so retry with backoff until the server
// accepts, capped so a genuinely dead sandbox surfaces an error instead of
// spinning silently.
//
// Visibility gate: reconnects are suspended while the tab is hidden. Reopening the
// WS to the sandbox host auto-resumes a paused sandbox (lifecycle.auto_resume), so
// an un-gated reconnect in a backgrounded tab silently wakes the sandbox and bills
// idle compute. We reconnect on focus instead; the server replays state on connect.
const MAX_RETRIES = 20
const retryDelayMs = (attempt: number): number => Math.min(1000, 150 * attempt)

// How long one credentials fetch may take before it is abandoned.
//
// WHAT THIS FIXES. `connecting` guards the await window inside connect(), and it
// is cleared only by the provider settling. A provider that never settles leaves
// it true forever, so every later connect() returns at the guard: no socket, no
// retry, and no `chat_error` either. The panel sits on "Connecting to the
// agent..." indefinitely, which is one of the only two paths that can produce
// that symptom.
//
// SIZED FROM THE COST OF THE THING IT BOUNDS, not picked round. /connect resumes
// the sandbox (~1s, `docs/realtime-architecture.md`), writes secrets, merges
// config, refreshes the FamilySearch token over the network and exposes the WS
// port (`sessions.py` connect_session). A legitimate call is seconds; 30 is
// generous enough not to fire on a slow one and short enough that a person is
// not left staring at a placeholder.
//
// NOT ON `api.req`. That is the shared REST helper, and `resumeSession` plus the
// viewer's /state hydration resume the same paused sandbox and are just as slow,
// so a blanket timeout there aborts them too. It is not at the `connectSession`
// call site either: the flag that actually wedges lives in this class, so the
// bound belongs here, where it also covers any future provider.
const CREDENTIALS_TIMEOUT_MS = 30_000

// A hang gets a TIGHTER ceiling than a refusal, and the asymmetry is the point.
// A refused socket is cheap and fast, so MAX_RETRIES of them is fine. Each
// credentials attempt is a full server-side E2B resume + secret write + config
// merge + FamilySearch token refresh, so retrying a hang 20 times would multiply
// that load by 20 against a control plane already failing to answer - trading a
// wedge for a stampede. Two, then tell the user.
// Worst case a user waits about 60 seconds before "Chat unavailable" appears:
// two CREDENTIALS_TIMEOUT_MS bounds plus the retry delay between them. That is
// the trade against an indefinite "Connecting to the agent..." placeholder,
// which is the failure this card exists to remove, and it is written down here
// rather than left to be derived from three constants.
const MAX_CREDENTIAL_TIMEOUTS = 2

/** The credentials fetch exceeded CREDENTIALS_TIMEOUT_MS. Distinct from a
 *  rejection: a rejection is an answer, this is the absence of one. */
class CredentialsTimeout extends Error {
  constructor() {
    super('credentials request timed out')
    this.name = 'CredentialsTimeout'
  }
}

export class WsSessionConnection implements SessionConnection {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private outbox: string[] = []
  private open = false
  private closed = false
  private attempts = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  // Tab-visibility gate: a backgrounded tab must NOT reconnect, because reopening
  // the WS to the sandbox host auto-resumes a paused sandbox (lifecycle.auto_resume),
  // silently billing compute for a tab nobody is viewing. Reconnects pause while
  // hidden and resume on focus.
  private hidden = false
  // Guards the await window inside connect(): without it a retry firing while
  // the credentials request is in flight would open a second socket.
  private connecting = false
  // Counts only credential fetches that never answered. Reset on SUCCESS, so an
  // intermittent control plane does not accumulate toward the ceiling across an
  // otherwise healthy session.
  //
  // NOT symmetric with `attempts`, which this used to claim: `onVisibility`
  // also resets `attempts` on focus, and this deliberately survives that.
  // Resetting it on focus would let tabbing away and back re-arm the stampede
  // the ceiling exists to prevent, which is a cheaper way to reach the failure
  // than the one this card is about. Pinned by
  // "focus does not reset the credential-timeout budget".
  private credentialTimeouts = 0

  private onVisibility = (): void => {
    if (typeof document === 'undefined') return
    if (document.visibilityState === 'hidden') {
      this.hidden = true
      // Cancel any pending reconnect so a backgrounded tab stops waking the sandbox.
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
    } else {
      this.hidden = false
      // Back in focus: reconnect with fresh backoff if the socket dropped while we
      // were hidden. The in-sandbox server replays snapshot + transcript on connect.
      this.attempts = 0
      if (!this.ws && !this.closed) this.connect()
    }
  }

  // `getCredentials` is called PER ATTEMPT, not once. The handshake token has a
  // finite TTL anchored to the /connect that minted it, so a captured token
  // eventually expires — and the sandbox pause that forces the reconnect is
  // exactly the event most likely to happen after it has. Re-minting also
  // resumes a paused sandbox and refreshes its running-timeout, since those are
  // what /connect does. It authenticates by session cookie, not by the WS token,
  // so it stays reachable even when the handshake is being rejected.
  constructor(private getCredentials: CredentialsProvider) {
    if (typeof document !== 'undefined') {
      this.hidden = document.visibilityState === 'hidden'
      document.addEventListener('visibilitychange', this.onVisibility)
    }
  }

  /** `getCredentials()` bounded by CREDENTIALS_TIMEOUT_MS.
   *
   *  The timer is always cleared, so a settled fetch leaves nothing pending. The
   *  losing side of the race is dropped rather than cancelled - there is no
   *  AbortSignal on the provider contract - so a late resolution is ignored; its
   *  only side effect is the `onFsState` callback, which is idempotent.
   */
  private credentials(): Promise<SessionCredentials> {
    return new Promise<SessionCredentials>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CredentialsTimeout()), CREDENTIALS_TIMEOUT_MS)
      this.getCredentials().then(
        (creds) => {
          clearTimeout(timer)
          resolve(creds)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }

  connect(): void {
    if (this.ws || this.closed || this.connecting) return
    this.connecting = true
    void this.credentials().then(
      (creds) => {
        this.connecting = false
        this.credentialTimeouts = 0
        // close() or a racing connect landed while we were awaiting.
        if (this.closed || this.ws) return
        // Backgrounded mid-fetch: opening now would auto-resume a paused sandbox
        // for a tab nobody is watching, which is what the visibility gate exists
        // to prevent. Drop these credentials; onVisibility reconnects on focus.
        if (this.hidden) return
        this.openSocket(creds)
      },
      (err) => {
        // The control plane is unreachable or the session is gone. Same backoff
        // as a refused socket, so this can't spin and can't hang silently.
        this.connecting = false
        if (this.closed || this.hidden) return
        if (err instanceof CredentialsTimeout) {
          this.credentialTimeouts += 1
          if (this.credentialTimeouts >= MAX_CREDENTIAL_TIMEOUTS) {
            this.fail('The agent is not responding (connection timed out).')
            return
          }
        }
        this.scheduleRetry()
      }
    )
  }

  private emitConn(state: 'open' | 'reconnecting'): void {
    for (const l of [...this.listeners]) l({ type: 'conn_state', state })
  }

  /** Surface a terminal connection failure. `chat_error` is what ChatPane turns
   *  into "Chat unavailable: ..."; without it the placeholder never resolves. */
  private fail(message: string): void {
    for (const l of [...this.listeners]) l({ type: 'status', state: 'chat_error', message })
  }

  private scheduleRetry(): void {
    this.attempts += 1
    if (this.attempts > MAX_RETRIES) {
      this.fail('Could not reach the agent (connection failed).')
      return
    }
    this.retryTimer = setTimeout(() => {
      if (!this.closed && !this.hidden) this.connect()
    }, retryDelayMs(this.attempts))
  }

  private openSocket(creds: SessionCredentials): void {
    const url = `${creds.wssUrl}/?token=${encodeURIComponent(creds.token)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      this.open = true
      this.attempts = 0
      for (const m of this.outbox) ws.send(m)
      this.outbox = []
      // Synthetic, client-only. Lets the UI tell "the agent is working" apart
      // from "the socket dropped and we're retrying" — otherwise a silent
      // reconnect looks identical to a busy agent (the 2026-07-20 confusion).
      this.emitConn('open')
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
      // Backgrounded tab: do NOT reconnect — reopening the WS would auto-resume a
      // paused sandbox, billing compute for a tab nobody is viewing. onVisibility
      // reconnects when the tab is focused again.
      if (this.hidden) return
      this.emitConn('reconnecting')
      this.scheduleRetry()
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility)
    }
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
