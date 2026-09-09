import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WsSessionConnection, type SessionCredentials, type WsMessage } from '../SessionConnection'

/**
 * `WsSessionConnection`'s connection state machine — the half of issue #1729
 * that is reachable from the client.
 *
 * WHY THIS FILE EXISTS. An indefinite "Connecting to the agent…" has only two
 * causes, and one of them is here: `connecting` guards the await window inside
 * `connect()` and is cleared only when the credentials provider settles. A
 * provider that never settles leaves it `true` forever, so every later
 * `connect()` returns at the guard — no socket, no retry, and no `chat_error`
 * either, which is what makes it a silent wedge rather than a visible failure.
 * The card was routed `senior` partly because nothing tested this class at all:
 * the one file that mentioned `SessionConnection` imported only its *type* for a
 * `fakeConn()` stub.
 *
 * `environment: 'node'` (apps/web/vitest.config.ts), so there is no DOM. The
 * class guards on `typeof document !== 'undefined'`, so it constructs fine
 * without one; `WebSocket` is stubbed per test. Deliberately not adding jsdom.
 */

const CREDENTIALS_TIMEOUT_MS = 30_000 // mirrors the module constant
const MAX_RETRIES = 20 // mirrors the module constant

class FakeSocket {
  static instances: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(raw: string): void {
    this.sent.push(raw)
  }
  close(): void {
    this.onclose?.()
  }
}

/** Collect every message the connection emits to its listeners. */
function listen(conn: WsSessionConnection): WsMessage[] {
  const seen: WsMessage[] = []
  conn.on((m) => seen.push(m))
  return seen
}

const errors = (seen: WsMessage[]): WsMessage[] =>
  seen.filter((m) => m.type === 'status' && m.state === 'chat_error')

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  ;(globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { WebSocket?: unknown }).WebSocket
})

describe('a credentials fetch that never settles', () => {
  it('does not wedge: it surfaces chat_error instead of leaving the panel connecting', async () => {
    // THE REGRESSION. Before the bound, this test hangs on a placeholder
    // forever: `connecting` stays true, so no retry and no error ever happen.
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      return new Promise<SessionCredentials>(() => {}) // never settles
    })
    const seen = listen(conn)

    conn.connect()
    expect(calls).toBe(1)
    expect(errors(seen)).toHaveLength(0)

    // First bound elapses -> retried rather than abandoned.
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10)
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toBe(2)
    expect(errors(seen)).toHaveLength(0)

    // Second bound elapses -> the user is told.
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10)
    expect(errors(seen)).toHaveLength(1)
    expect(String(errors(seen)[0].message)).toMatch(/not responding|timed out/i)
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('does not stampede the control plane: a hang costs 2 attempts, not MAX_RETRIES', async () => {
    // Each attempt is a full server-side E2B resume + secret write + config
    // merge + FamilySearch token refresh. Giving a hang the same 20-retry budget
    // as a cheap socket refusal would trade a wedge for a stampede against a
    // control plane already failing to answer.
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      return new Promise<SessionCredentials>(() => {})
    })
    const seen = listen(conn)
    conn.connect()
    for (let i = 0; i < MAX_RETRIES + 5; i++) {
      await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10)
      await vi.advanceTimersByTimeAsync(2000)
    }
    expect(calls).toBe(2)
    expect(errors(seen)).toHaveLength(1)
  })
})

describe('a credentials fetch that is rejected', () => {
  it('retries with backoff and eventually surfaces chat_error', async () => {
    // A rejection is an ANSWER: cheap and fast, so it keeps the full retry
    // budget. The distinction from a hang is deliberate.
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      return Promise.reject(new Error('session is gone'))
    })
    const seen = listen(conn)

    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(errors(seen)).toHaveLength(0)

    for (let i = 0; i < MAX_RETRIES + 2; i++) await vi.advanceTimersByTimeAsync(2000)

    expect(errors(seen)).toHaveLength(1)
    expect(String(errors(seen)[0].message)).toMatch(/could not reach the agent/i)
    // The ceiling is real: attempts stop rather than spinning.
    const settled = calls
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toBe(settled)
  })

  it('holds the retry ceiling at MAX_RETRIES attempts', async () => {
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      return Promise.reject(new Error('nope'))
    })
    const seen = listen(conn)
    conn.connect()
    for (let i = 0; i < MAX_RETRIES + 10; i++) await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toBe(MAX_RETRIES + 1) // the first attempt, then MAX_RETRIES retries
    expect(errors(seen)).toHaveLength(1)
  })
})

describe('the happy path still works', () => {
  it('opens a socket, flushes the outbox, and resets the timeout budget', async () => {
    // The other direction. A bound that fires on a healthy connect would be
    // worse than the wedge, so this asserts the normal path is untouched.
    const conn = new WsSessionConnection(async () => ({ wssUrl: 'ws://x', token: 't' }))
    const seen = listen(conn)

    conn.send({ type: 'user_msg', text: 'queued before open' })
    conn.connect()
    await vi.advanceTimersByTimeAsync(0)

    expect(FakeSocket.instances).toHaveLength(1)
    const sock = FakeSocket.instances[0]
    expect(sock.url).toContain('token=t')
    sock.onopen?.()

    expect(sock.sent).toHaveLength(1)
    expect(JSON.parse(sock.sent[0]).text).toBe('queued before open')
    expect(seen.some((m) => m.type === 'conn_state' && m.state === 'open')).toBe(true)
    expect(errors(seen)).toHaveLength(0)

    // A slow-but-successful connect must not be counted as a timeout.
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS * 3)
    expect(errors(seen)).toHaveLength(0)
  })

  it('a connect slower than nothing-in-particular but under the bound still opens', async () => {
    const conn = new WsSessionConnection(
      () =>
        new Promise<SessionCredentials>((resolve) =>
          setTimeout(() => resolve({ wssUrl: 'ws://x', token: 't' }), CREDENTIALS_TIMEOUT_MS - 5_000)
        )
    )
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS - 4_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(errors(seen)).toHaveLength(0)
  })
})
