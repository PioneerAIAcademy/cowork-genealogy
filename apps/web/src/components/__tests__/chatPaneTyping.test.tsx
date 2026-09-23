import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import ChatPane from '../ChatPane'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'
import { TURN_OUTCOME_LABELS, SPEND_CAP_LABEL } from '../chatEvents'

// research-as-a-job 1b and 1c, through the real component.
//
// WHY THIS FILE EXISTS. The mutation check reverted all eight ChatPane.tsx hunks of that
// work INDIVIDUALLY and no test noticed a single one — including the line that IS the
// fix, `if (!trimmed || busy) return`. The plan calls that guard the reason 1b exists
// ("the shipped UI silently drops input while a turn runs"), and the 66 tests in this
// directory covered only the pure helpers in chatEvents.ts. Reverting the fix left the
// suite green.
//
// These assert the MECHANISM, not a rendered state that another path could produce:
// what reached `conn.send`, and how many times.

class FakeConn implements SessionConnection {
  sent: WsMessage[] = []
  private listeners = new Set<Listener>()
  connect(): void {}
  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(obj: WsMessage): void {
    this.sent.push(obj)
  }
  close(): void {}
  /** Push a frame at the component exactly as the transport would. */
  emit(msg: WsMessage): void {
    act(() => {
      for (const l of this.listeners) l(msg)
    })
  }
}

function mount(): { conn: FakeConn } {
  const conn = new FakeConn()
  render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
  // The tier declares the session ready; without this the composer is in its
  // "Connecting…" state and nothing here would be about `busy` at all.
  conn.emit({ type: 'status', state: 'chat_ready' })
  return { conn }
}

/** Start a turn the way the user does, and assert it actually started. */
function startTurn(conn: FakeConn): void {
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: 'find his parents' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(conn.sent).toHaveLength(1)
}

// jsdom implements no scrolling. ChatPane follows new content on every render, so
// without these every test dies in an effect rather than on its assertion.
beforeEach(() => {
  vi.restoreAllMocks()
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

// This project does not enable testing-library's auto-cleanup, so without this every
// render accumulates and `getByRole` finds the previous test's composer too.
afterEach(cleanup)

describe('1b: a message typed while a turn is running', () => {
  it('reaches the server instead of being silently dropped', () => {
    const { conn } = mount()
    startTurn(conn)

    // Mid-turn. The old `|| busy` guard returned here and nothing happened at
    // all — no send, no bubble, no error. For a median 53-minute turn that was
    // most of the run.
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'also check the 1881 census' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(conn.sent).toHaveLength(2)
    expect(conn.sent[1]).toMatchObject({ type: 'user_msg', text: 'also check the 1881 census' })
  })

  it('tells the user it is waiting, rather than looking like it was ignored', () => {
    const { conn } = mount()
    startTurn(conn)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'also the 1881 census' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(screen.getByText(/picked up at the next step/i)).toBeTruthy()
  })

  it('clears that label at turn_done, which is when the message is picked up', () => {
    const { conn } = mount()
    startTurn(conn)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'also the 1881 census' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByText(/picked up at the next step/i)).toBeTruthy()

    conn.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
    expect(screen.queryByText(/picked up at the next step/i)).toBeNull()
  })

  it('does not label a message sent when nothing is running', () => {
    const { conn } = mount()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'next question' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(conn.sent).toHaveLength(2)
    expect(screen.queryByText(/picked up at the next step/i)).toBeNull()
  })

  it('still refuses an empty message, so the guard was narrowed and not deleted', () => {
    const { conn } = mount()
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(conn.sent).toHaveLength(0)
  })
})

describe('1b: a message held for a tab that did not send it', () => {
  // The per-bubble label covers the tab that typed the message. A reload, or a second
  // tab, learns it only from these frames -- and without them the feed looks idle while
  // a message sits waiting. Reverting this handler broke no test until now.
  it('announces a message held on the server', () => {
    const { conn } = mount()
    startTurn(conn)
    expect(screen.queryByText(/a message is waiting/i)).toBeNull()

    conn.emit({ type: 'status', state: 'turn_queued' })
    expect(screen.getByText(/a message is waiting/i)).toBeTruthy()
  })

  it('stops announcing it once the server releases it', () => {
    const { conn } = mount()
    startTurn(conn)
    conn.emit({ type: 'status', state: 'turn_queued' })
    expect(screen.queryByText(/a message is waiting/i)).toBeTruthy()

    conn.emit({ type: 'status', state: 'turn_unqueued' })
    expect(screen.queryByText(/a message is waiting/i)).toBeNull()
  })

  it('does not double up when THIS tab is the one that typed it', () => {
    const { conn } = mount()
    startTurn(conn)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'also the 1881 census' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    conn.emit({ type: 'status', state: 'turn_queued' })

    // The bubble already says it. A second, vaguer line would be noise.
    expect(screen.getByText(/picked up at the next step/i)).toBeTruthy()
    expect(screen.queryByText(/a message is waiting/i)).toBeNull()
  })
})

describe('1b: Send sits beside Stop, it does not replace it', () => {
  it('offers both while a turn runs', () => {
    const { conn } = mount()
    startTurn(conn)
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeTruthy()
  })

  it('offers Send alone when idle', () => {
    const { conn } = mount()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
    expect(screen.queryByRole('button', { name: /^stop$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeTruthy()
  })
})

describe('1c: Stop', () => {
  it('sends exactly one interrupt, and only while a turn is running', () => {
    const { conn } = mount()
    startTurn(conn)
    fireEvent.click(screen.getByRole('button', { name: /^stop$/i }))

    const interrupts = conn.sent.filter((m) => m.type === 'interrupt')
    expect(interrupts).toHaveLength(1)
  })

  it('renders each terminal outcome, so a capped run is not read as finished', () => {
    // Asserted against the exported map, not against wording written here: this test
    // owns the WIRING (does the frame's outcome reach the screen), and
    // chatEvents.test.ts owns what each label says. A regex guessed here would go
    // stale against the labels and prove nothing either way.
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ kind: 'turn_done', outcome: 'completed' }, TURN_OUTCOME_LABELS.completed],
      [{ kind: 'turn_done', outcome: 'stopped' }, TURN_OUTCOME_LABELS.stopped],
      [{ kind: 'turn_done', outcome: 'no_progress' }, TURN_OUTCOME_LABELS.no_progress],
      [{ kind: 'turn_done', outcome: 'budget' }, TURN_OUTCOME_LABELS.budget],
      [{ kind: 'turn_done', outcome: 'mcp_unavailable' }, TURN_OUTCOME_LABELS.mcp_unavailable],
      [{ kind: 'turn_done', outcome: 'budget', limit: 'spend' }, SPEND_CAP_LABEL]
    ]
    const seen = new Set<string>()
    for (const [event, label] of cases) {
      const { conn } = mount()
      startTurn(conn)
      conn.emit({ type: 'agent_event', event })
      expect(screen.getByText(label)).toBeTruthy()
      seen.add(label)
      cleanup() // one mounted pane per case, or the next query is ambiguous
    }
    expect(seen.size).toBe(cases.length) // every ending reads differently on screen
  })

  it('says nothing for an ordinary finish', () => {
    const { conn } = mount()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'ok' } })
    expect(screen.queryByText(/research complete|stopped|budget|no progress/i)).toBeNull()
  })
})
