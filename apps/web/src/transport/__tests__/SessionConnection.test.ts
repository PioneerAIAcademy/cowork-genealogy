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

// `conn_state`, not `status` — `emitConn` and `fail` use different frame types,
// and filtering on the wrong one reads as "never emitted" rather than as a bug
// in the filter.
const reconnecting = (seen: WsMessage[]): WsMessage[] =>
  seen.filter((m) => m.type === 'conn_state' && m.state === 'reconnecting')

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

  it('a success between two hangs resets the budget, so an intermittent control plane does not accumulate', async () => {
    // The reset on success is what keeps a long, mostly-healthy session from
    // reaching the ceiling on two timeouts an hour apart. Nothing pinned it:
    // deleting `this.credentialTimeouts = 0` from connect()'s success path left
    // all 21 tests green, including the one whose NAME claims to cover it.
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      if (calls === 2) return Promise.resolve({ wssUrl: 'ws://x', token: 't' })
      return new Promise<SessionCredentials>(() => {}) // calls 1 and 3 hang
    })
    const seen = listen(conn)

    conn.connect()
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10) // hang #1
    await vi.advanceTimersByTimeAsync(2000)                        // retry -> succeeds
    expect(FakeSocket.instances).toHaveLength(1)
    FakeSocket.instances[0].onopen?.()

    // Socket drops; the next attempt hangs too. With the budget reset by the
    // success that is timeout #1 again, not #2, so no terminal error.
    FakeSocket.instances[0].close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toBe(3)
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10) // hang #2
    expect(errors(seen)).toHaveLength(0)
  })

  it('focus does not reset the credential-timeout budget', async () => {
    // The budget deliberately survives a visibility change, unlike `attempts`,
    // which onVisibility does reset. Resetting it on focus would let tabbing
    // away and back re-arm the stampede the ceiling exists to prevent -- a
    // cheaper route to the failure than the one this card is about.
    //
    // Unpinned before this: adding `this.credentialTimeouts = 0` beside the
    // `attempts` reset in onVisibility left all 22 tests green, so the comment
    // asserting the asymmetry was the only thing holding it.
    const conn = new WsSessionConnection(
      () => new Promise<SessionCredentials>(() => {}) // always hangs
    )
    const seen = listen(conn)

    conn.connect()
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10) // timeout #1

    // A focus event between the two timeouts. This suite runs with
    // `environment: 'node'`, so `document` is undefined and `onVisibility`
    // returns at its own `typeof document === 'undefined'` guard -- calling it
    // bare makes this test pass whatever the code does. Found by break-testing:
    // adding the focus reset left it green. Stub the minimum it reads.
    ;(globalThis as { document?: unknown }).document = { visibilityState: 'visible' }
    try {
      ;(conn as unknown as { onVisibility: () => void }).onVisibility()
    } finally {
      delete (globalThis as { document?: unknown }).document
    }

    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(CREDENTIALS_TIMEOUT_MS + 10) // timeout #2
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
  it('tells the UI it is retrying, on every attempt, not just at the end', async () => {
    // The panel showed one static line for the whole window: this path retried
    // silently, so a failing `/connect` was indistinguishable from a healthy
    // slow one until it gave up.
    const conn = new WsSessionConnection(() => Promise.reject(new Error('500')))
    const seen = listen(conn)

    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    const afterFirst = reconnecting(seen).length
    expect(afterFirst).toBeGreaterThan(0)
    expect(errors(seen)).toHaveLength(0)

    for (let i = 0; i < MAX_RETRIES + 2; i++) await vi.advanceTimersByTimeAsync(2000)

    // It keeps saying so as the backoff runs, rather than going quiet after one.
    expect(reconnecting(seen).length).toBeGreaterThan(afterFirst)
  })

  it('stays silent while the tab is hidden', async () => {
    // The `hidden` guard sits above the new emit, so a backgrounded tab still
    // says nothing — otherwise this chatters at a tab nobody is looking at.
    const conn = new WsSessionConnection(() => Promise.reject(new Error('500')))
    const seen = listen(conn)
    ;(conn as unknown as { hidden: boolean }).hidden = true

    conn.connect()
    for (let i = 0; i < MAX_RETRIES + 2; i++) await vi.advanceTimersByTimeAsync(2000)

    expect(reconnecting(seen)).toHaveLength(0)
  })

})

describe('the happy path still works', () => {
  it('opens a socket, flushes the outbox, and does not count a slow success as a timeout', async () => {
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

    // A slow-but-successful connect must not be counted as a timeout. This is
    // the INCREMENT direction only: it says nothing about resetting a budget
    // that is already nonzero, which is why deleting the reset left it green.
    // That direction is pinned in the never-settles block above.
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

/** Drive failures until the retry ceiling, without the two artifacts that make
 *  this easy to get wrong: calling `onopen` resets the attempt budget (so the
 *  count never climbs), and closing an already-dead socket after exhaustion
 *  re-enters `scheduleRetry` and emits a second `chat_error`. Stops at the first
 *  terminal error, which is the thing under test. */
async function failUntilCeiling(seen: WsMessage[], close: (s: FakeSocket) => void): Promise<void> {
  for (let i = 0; i < MAX_RETRIES + 5; i++) {
    if (errors(seen).length) return
    const s = FakeSocket.instances[FakeSocket.instances.length - 1]
    if (s) close(s)
    await vi.advanceTimersByTimeAsync(2000)
  }
}

// ─── [R8] What the user is told while it retries, and when it gives up ──────
//
// Two findings restored from the deleted `docs/ux-findings.md`, neither of which
// had an issue. Both are about a message that is technically true and useless:
// "Reconnecting…" that never says which attempt, and "Could not reach the agent"
// that cannot tell a sandbox that is GONE from a healthy one this network cannot
// reach. Those are different faults with different fixes, and diagnosing one live
// took a process table.

describe('[R8] the reconnect indicator carries the attempt number', () => {
  it('every reconnecting frame says which attempt it is, and the ceiling', async () => {
    const conn = new WsSessionConnection(() => Promise.resolve({ wssUrl: 'ws://x', token: 't' }))
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.instances[0].onopen?.()
    FakeSocket.instances[0].close()

    const frames = reconnecting(seen)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames[0].attempt).toBe(1)
    expect(frames[0].maxAttempts).toBe(MAX_RETRIES)
  })

  it('the attempt number climbs, so 2-of-20 and 19-of-20 are distinguishable', async () => {
    // The whole point: one is worth waiting through and the other is about to
    // give up, and the user is the one deciding whether to wait.
    const conn = new WsSessionConnection(() => Promise.resolve({ wssUrl: 'ws://x', token: 't' }))
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    // NO `onopen` here. A successful open resets the budget to 0, which is
    // correct behaviour and would hold every frame at "attempt 1".
    for (let i = 0; i < 4; i++) {
      const s = FakeSocket.instances[FakeSocket.instances.length - 1]
      if (s) s.close()
      await vi.advanceTimersByTimeAsync(2000)
    }
    const nums = reconnecting(seen).map((f) => f.attempt)
    expect(nums.length).toBeGreaterThan(2)
    expect(new Set(nums).size).toBeGreaterThan(1)
  })

  it('an OPEN frame carries no attempt number — there is no attempt in progress', async () => {
    const conn = new WsSessionConnection(() => Promise.resolve({ wssUrl: 'ws://x', token: 't' }))
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.instances[0].onopen?.()
    const open = seen.filter((m) => m.type === 'conn_state' && m.state === 'open')
    expect(open).toHaveLength(1)
    expect(open[0].attempt).toBeUndefined()
  })
})

describe('[R8] a terminal failure says what actually went wrong', () => {
  it('names the attempt count and the last cause, not just "could not reach"', async () => {
    const conn = new WsSessionConnection(() =>
      Promise.reject(new Error('session 404: not found'))
    )
    const seen = listen(conn)
    conn.connect()
    for (let i = 0; i < MAX_RETRIES + 2; i++) await vi.advanceTimersByTimeAsync(2000)

    expect(errors(seen)).toHaveLength(1)
    const msg = String(errors(seen)[0].message)
    expect(msg).toMatch(new RegExp(String(MAX_RETRIES)))
    expect(msg).toMatch(/session 404: not found/)
  })

  it('a socket that never reached the server reads differently from one the server closed', async () => {
    // 1006 (no close frame) means it never got there — network or sandbox down.
    // A real code came FROM the server, so the server was reachable. Opposite
    // faults, and the close code is the only thing that separates them.
    const conn = new WsSessionConnection(() => Promise.resolve({ wssUrl: 'ws://x', token: 't' }))
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(0)
    await failUntilCeiling(seen, (s) =>
      (s.onclose as ((ev?: unknown) => void) | null)?.({ code: 1006, reason: '' })
    )
    expect(errors(seen)).toHaveLength(1)
    expect(String(errors(seen)[0].message)).toMatch(/without reaching the server/i)
  })

  it('a healthy open resets the clock, so the elapsed time is THIS outage not an old one', async () => {
    // What the reset actually protects is the ELAPSED figure, and testing it via
    // the cause string does not work: every later failure calls `noteFailure`
    // and overwrites the old cause anyway, so a missing reset stays invisible
    // there. Mutation-checked — deleting the reset leaves a cause-based
    // assertion green and this one red.
    let calls = 0
    const conn = new WsSessionConnection(() => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('an old, unrelated fault'))
      return Promise.resolve({ wssUrl: 'ws://x', token: 't' })
    })
    const seen = listen(conn)
    conn.connect()
    await vi.advanceTimersByTimeAsync(2000)
    FakeSocket.instances[FakeSocket.instances.length - 1].onopen?.()

    // An hour of healthy session between the old fault and the new outage.
    await vi.advanceTimersByTimeAsync(3_600_000)

    await failUntilCeiling(seen, (s) =>
      (s.onclose as ((ev?: unknown) => void) | null)?.({ code: 1006, reason: '' })
    )
    expect(errors(seen)).toHaveLength(1)
    const msg = String(errors(seen)[0].message)
    const seconds = Number(/over (\d+)s/.exec(msg)?.[1] ?? 0)
    // The ceiling is reached in well under a minute of retries; an unreset clock
    // would report the hour of healthy session as part of the outage.
    expect(seconds).toBeLessThan(600)
    expect(msg).not.toMatch(/an old, unrelated fault/)
  })
})
