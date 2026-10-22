import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import ChatPane from '../ChatPane'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'
import { CONNECT_SLOW_MS, CONNECT_LOST_NOTE } from '../chatEvents'

// A UX finding from testing the branch by hand, 2026-10-13.
//
// The dev server restarted (uvicorn --reload, watching a tree that was being edited),
// which killed the in-process sandbox an open tab was attached to. The tab then showed
// `Connecting to the agent…` indefinitely: no timeout, no error, and nothing telling the
// reader that reloading was the fix. There IS a `chat_error` path, but it requires the
// server to SEND something, and a sandbox that vanished sends nothing at all.
//
// So the component could not distinguish "still connecting" from "the thing I was
// connected to is gone", and rendered the optimistic one forever.

class FakeConn implements SessionConnection {
  private listeners = new Set<Listener>()
  connect(): void {}
  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(): void {}
  close(): void {}
  emit(msg: WsMessage): void {
    act(() => {
      for (const l of this.listeners) l(msg)
    })
  }
}

function mount(): FakeConn {
  // jsdom has no scrollTo, and ChatPane scrolls on every render. Same stub the sibling
  // ChatPane suite uses.
  Element.prototype.scrollTo = vi.fn()
  const conn = new FakeConn()
  render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
  return conn
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ChatPane — a connection that never arrives', () => {
  it('says nothing new while a healthy connect is still in flight', () => {
    vi.useFakeTimers()
    mount()
    act(() => void vi.advanceTimersByTime(CONNECT_SLOW_MS - 1))
    expect(screen.queryByText(CONNECT_LOST_NOTE)).toBeNull()
    expect(screen.getByText(/Connecting to the agent/)).toBeTruthy()
  })

  it('admits the connection may be gone, and says what to do, once the wait is up', () => {
    vi.useFakeTimers()
    mount()
    act(() => void vi.advanceTimersByTime(CONNECT_SLOW_MS))
    const note = screen.getByText(CONNECT_LOST_NOTE)
    expect(note).toBeTruthy()
    // The whole point is actionability: a notice that does not name the fix leaves the
    // reader exactly where the old copy did.
    expect(CONNECT_LOST_NOTE).toMatch(/reload/i)
  })

  it('never shows the notice when the session becomes ready', () => {
    vi.useFakeTimers()
    const conn = mount()
    conn.emit({ type: 'status', state: 'chat_ready' })
    act(() => void vi.advanceTimersByTime(CONNECT_SLOW_MS * 4))
    expect(screen.queryByText(CONNECT_LOST_NOTE)).toBeNull()
  })

  it('clears the notice if the connection arrives late', () => {
    vi.useFakeTimers()
    const conn = mount()
    act(() => void vi.advanceTimersByTime(CONNECT_SLOW_MS))
    expect(screen.getByText(CONNECT_LOST_NOTE)).toBeTruthy()
    conn.emit({ type: 'status', state: 'chat_ready' })
    expect(screen.queryByText(CONNECT_LOST_NOTE)).toBeNull()
  })

  it('defers to the server\'s own error when there is one', () => {
    // `chat_error` sets ready false AND posts a message, and the placeholder renders only
    // on an empty chat -- so the specific error displaces this generic notice rather than
    // competing with it. That is the right way round: "Chat unavailable: <reason>" tells
    // the reader more than "still waiting" ever could.
    //
    // Pinned because the obvious "simplification" is to show the notice whenever ready is
    // false, which would put a vague line underneath a precise one.
    vi.useFakeTimers()
    const conn = mount()
    conn.emit({ type: 'status', state: 'chat_ready' })
    conn.emit({ type: 'status', state: 'chat_error', message: 'sandbox gone' })
    act(() => void vi.advanceTimersByTime(CONNECT_SLOW_MS * 2))
    expect(screen.queryByText(CONNECT_LOST_NOTE)).toBeNull()
    expect(screen.getByText(/Chat unavailable: sandbox gone/)).toBeTruthy()
  })
})
