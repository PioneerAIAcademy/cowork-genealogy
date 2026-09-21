import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SseSessionConnection } from '../SseSessionConnection'
import type { WsMessage } from '../SessionConnection'

/**
 * `SseSessionConnection` — the prototype transport (apps/server/proto/web).
 *
 * `environment: 'node'` (apps/web/vitest.config.ts): `EventSource` is a fake global
 * and `fetch` is stubbed per test. The one behaviour here that is not a plain relay
 * is the user_msg echo: `ChatPane.send()` draws the bubble and draws another on every
 * `user_msg` frame, and unlike the WS server the tier streams the row it just wrote.
 */

const CLOSED = 2

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  close(): void {
    this.closed = true
    this.readyState = CLOSED
  }
  // Test helpers.
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  frame(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  fail(readyState: number): void {
    this.readyState = readyState
    this.onerror?.()
  }
}

function listen(conn: SseSessionConnection): WsMessage[] {
  const seen: WsMessage[] = []
  conn.on((m) => seen.push(m))
  return seen
}

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SseSessionConnection — stream', () => {
  it('opens the stream from seq 0 and reports open + chat_ready', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    expect(last().url).toBe('/api/sessions/s1/events/stream?after=0')
    last().open()
    expect(seen).toEqual([
      { type: 'conn_state', state: 'open' },
      { type: 'status', state: 'chat_ready' }
    ])
    conn.close()
    expect(last().closed).toBe(true)
  })

  it('relays frames, tracks the cursor, and drops a seq it has already folded', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    last().frame({ type: 'user_msg', text: 'hi', turn_id: 't', seq: 1 })
    last().frame({ type: 'agent_event', event: { kind: 'text', text: 'Hello' }, seq: 2 })
    last().frame({ type: 'agent_event', event: { kind: 'task_progress', agent: 'x' } }) // transient, no seq
    last().frame({ type: 'agent_event', event: { kind: 'text', text: 'dup' }, seq: 2 }) // the reconnect edge
    expect(seen.slice(2).map((m) => [m.type, m.seq])).toEqual([
      ['user_msg', 1],
      ['agent_event', 2],
      ['agent_event', undefined]
    ])
    conn.close()
  })

  it('leaves a CONNECTING error to the browser and retries a CLOSED one with the cursor', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    last().frame({ type: 'agent_event', event: { kind: 'text', text: 'a' }, seq: 7 })
    last().fail(0) // CONNECTING: the EventSource reconnects itself with Last-Event-ID
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(seen.filter((m) => m.type === 'conn_state' && m.state === 'reconnecting')).toHaveLength(1)

    last().fail(CLOSED) // the browser gave up
    vi.advanceTimersByTime(1000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(last().url).toBe('/api/sessions/s1/events/stream?after=7')
    conn.close()
  })

  it('gives up with chat_error after a few CLOSED streams — the browser will not retry a 404', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    for (let i = 0; i < 4; i++) {
      last().fail(CLOSED)
      vi.advanceTimersByTime(1000)
    }
    expect(seen.filter((m) => m.type === 'status' && m.state === 'chat_error')).toHaveLength(1)
    expect(FakeEventSource.instances).toHaveLength(4) // three retries of ours, then stop
    conn.close()
  })

  it('an unreachable tier: after MAX_RETRIES CONNECTING errors, closes the stream and reports chat_error', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    const es = last()
    for (let i = 0; i < 21; i++) es.fail(0) // the browser's own retries, each firing onerror
    expect(FakeEventSource.instances).toHaveLength(1) // we never opened a second one
    expect(es.closed).toBe(true)
    expect(seen.filter((m) => m.type === 'status' && m.state === 'chat_error')).toHaveLength(1)
    conn.close()
  })

  it('an open resets the error count', () => {
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    const es = last()
    for (let i = 0; i < 15; i++) es.fail(0)
    es.open()
    for (let i = 0; i < 15; i++) es.fail(0)
    expect(es.closed).toBe(false)
    expect(seen.filter((m) => m.type === 'status' && m.state === 'chat_error')).toHaveLength(0)
    conn.close()
  })
})

describe('SseSessionConnection — send', () => {
  it('POSTs user_msg to /messages and drops its own echo, but relays a replayed user_msg', async () => {
    const fetchFn = stubFetch(202, { turn_id: 't1', seq: 3 })
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    // History replay from before this send: relayed.
    last().frame({ type: 'user_msg', text: 'earlier', turn_id: 't0', seq: 1 })

    conn.send({ type: 'user_msg', text: 'Find Thomas Flynn' })
    await flush()
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/sessions/s1/messages',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'Find Thomas Flynn' }) })
    )
    // The echo of the row the tier just wrote: not relayed (ChatPane already drew it).
    last().frame({ type: 'user_msg', text: 'Find Thomas Flynn', turn_id: 't1', seq: 3 })
    // A later user_msg with the same text from someone else IS relayed (the guard is counted).
    last().frame({ type: 'user_msg', text: 'Find Thomas Flynn', turn_id: 't2', seq: 4 })

    const users = seen.filter((m) => m.type === 'user_msg').map((m) => m.seq)
    expect(users).toEqual([1, 4])
    conn.close()
  })

  it('drops the echo even when the frame lands before the POST resolves', async () => {
    let resolvePost: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => (resolvePost = r)))
    )
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    conn.send({ type: 'user_msg', text: 'quick' })
    last().frame({ type: 'user_msg', text: 'quick', turn_id: 't', seq: 1 }) // the 1 s poll beat the response
    resolvePost({ ok: true, status: 202, statusText: '', json: async () => ({ turn_id: 't', seq: 1 }) })
    await flush()
    expect(seen.filter((m) => m.type === 'user_msg')).toHaveLength(0)
    conn.close()
  })

  it('holds other user_msg frames while a POST is in flight and relays them after the 202', async () => {
    let resolvePost: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => (resolvePost = r)))
    )
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    conn.send({ type: 'user_msg', text: 'mine' })
    last().frame({ type: 'user_msg', text: 'from another tab', turn_id: 'tx', seq: 5 }) // held
    last().frame({ type: 'user_msg', text: 'mine', turn_id: 't', seq: 6 }) // held; the echo
    last().frame({ type: 'agent_event', event: { kind: 'text', text: 'not held' }, seq: 7 })
    expect(seen.filter((m) => m.type === 'user_msg')).toHaveLength(0)
    resolvePost({ ok: true, status: 202, statusText: '', json: async () => ({ turn_id: 't', seq: 6 }) })
    await flush()
    expect(seen.filter((m) => m.type === 'user_msg').map((m) => m.seq)).toEqual([5])
    expect(seen.filter((m) => m.type === 'agent_event').map((m) => m.seq)).toEqual([7])
    conn.close()
  })

  it('a rejected POST surfaces an error, ends the turn the UI started, and still drops the echo', async () => {
    // The tier commits the user_msg row BEFORE the queue send and keeps it on 502, so the
    // 502's detail names the seq; without dropping it the message would appear twice.
    stubFetch(502, { detail: { message: 'queue send failed: elasticmq is down', turn_id: 't', seq: 1 } })
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    conn.send({ type: 'user_msg', text: 'hello' })
    await flush()
    const events = seen.filter((m) => m.type === 'agent_event').map((m) => m.event as { kind: string; text?: string })
    expect(events.map((e) => e.kind)).toEqual(['error', 'turn_done'])
    expect(events[0].text).toContain('elasticmq is down')
    last().frame({ type: 'user_msg', text: 'hello', turn_id: 't', seq: 1 }) // the echo of the kept row
    last().frame({ type: 'user_msg', text: 'other', turn_id: 't2', seq: 2 }) // not ours: relayed
    expect(seen.filter((m) => m.type === 'user_msg').map((m) => m.seq)).toEqual([2])
    conn.close()
  })

  it('a failure that names no row (a 404) drops nothing and relays a later user_msg', async () => {
    stubFetch(404, { detail: 'Session not found' })
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    conn.send({ type: 'user_msg', text: 'hello' })
    await flush()
    expect((seen.find((m) => m.type === 'agent_event')?.event as { text: string }).text).toContain('Session not found')
    last().frame({ type: 'user_msg', text: 'hello', turn_id: 't', seq: 1 })
    expect(seen.filter((m) => m.type === 'user_msg')).toHaveLength(1)
    conn.close()
  })

  it('interrupt POSTs /interrupt and a 501 becomes an error without turn_done', async () => {
    const fetchFn = stubFetch(501, { detail: 'Interrupt is not available in the prototype' })
    const conn = new SseSessionConnection('s1')
    const seen = listen(conn)
    conn.connect()
    last().open()
    conn.send({ type: 'interrupt' })
    await flush()
    expect(fetchFn).toHaveBeenCalledWith('/api/sessions/s1/interrupt', expect.objectContaining({ method: 'POST' }))
    const events = seen.filter((m) => m.type === 'agent_event').map((m) => (m.event as { kind: string }).kind)
    expect(events).toEqual(['error'])
    conn.close()
  })
})
