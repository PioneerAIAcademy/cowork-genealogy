import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import ChatPane from '../ChatPane'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'
import { TURN_OUTCOME_LABELS, SPEND_CAP_LABEL, COMPACTING_LABEL } from '../chatEvents'

// PR #2870 items 1b and 1c, through the real component.
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

    expect(screen.getByText(/waiting — sent, not yet picked up/i)).toBeTruthy()
  })

  it('clears that label at turn_done, which is when the message is picked up', () => {
    const { conn } = mount()
    startTurn(conn)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'also the 1881 census' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByText(/waiting — sent, not yet picked up/i)).toBeTruthy()

    conn.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
    expect(screen.queryByText(/waiting — sent, not yet picked up/i)).toBeNull()
  })

  it('does not label a message sent when nothing is running', () => {
    const { conn } = mount()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done' } })
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'next question' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(conn.sent).toHaveLength(2)
    expect(screen.queryByText(/waiting — sent, not yet picked up/i)).toBeNull()
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
    expect(screen.getByText(/waiting — sent, not yet picked up/i)).toBeTruthy()
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
      [{ kind: 'turn_done', outcome: 'delivered' }, TURN_OUTCOME_LABELS.delivered],
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
    // Derived from the labels themselves: the old regex could not match the
    // reworded `completed` label, so this could no longer fail on a leak.
    for (const label of Object.values(TURN_OUTCOME_LABELS)) expect(screen.queryByText(label)).toBeNull()
  })
})

// ─── [R8] the reconnect line says which attempt ─────────────────────────────

describe('[R8] Reconnecting shows the attempt number', () => {
  it('renders "attempt N of M" when the transport sends one', () => {
    const { conn } = mount()
    conn.emit({ type: 'conn_state', state: 'reconnecting', attempt: 3, maxAttempts: 20 })
    expect(screen.getByText(/Reconnecting \(attempt 3 of 20\)/)).toBeTruthy()
  })

  it('falls back to the bare label when no count is sent', () => {
    // `SseSessionConnection` emits `conn_state` with no attempt fields. Rendering
    // "attempt undefined of undefined" there would be worse than saying nothing.
    const { conn } = mount()
    conn.emit({ type: 'conn_state', state: 'reconnecting' })
    const el = screen.getByText(/Reconnecting/)
    expect(el.textContent).not.toMatch(/undefined|NaN|attempt/)
  })

  it('the whole reconnect line goes when the attempts are over, not just the count', () => {
    // What does the work here is `setConnState('open')` on the chat_error path,
    // which un-renders the line entirely. A separate `setConnAttempt(null)` was
    // written beside it and then deleted: the count is only ever read while
    // connState is 'reconnecting', so clearing it was unobservable — the
    // mutation check caught this test passing for the wrong reason.
    const { conn } = mount()
    conn.emit({ type: 'conn_state', state: 'reconnecting', attempt: 19, maxAttempts: 20 })
    expect(screen.getByText(/attempt 19 of 20/)).toBeTruthy()
    conn.emit({ type: 'status', state: 'chat_error', message: 'Could not reach the agent.' })
    expect(screen.queryByText(/Reconnecting/)).toBeNull()
    expect(screen.queryByText(/attempt 19 of 20/)).toBeNull()
  })

  it('the terminal error carries the diagnosis the transport put in it', () => {
    const { conn } = mount()
    conn.emit({
      type: 'status',
      state: 'chat_error',
      message:
        'Could not reach the agent after 20 attempts over 42s. ' +
        'Last failure: the socket closed without reaching the server (network or sandbox down).',
    })
    expect(screen.getByText(/without reaching the server/)).toBeTruthy()
    expect(screen.getByText(/20 attempts/)).toBeTruthy()
  })
})

describe('continuing on the same project after a spend stop', () => {
  // Phase 2's acceptance: "a session stopped at the spend bound continues on the same
  // project in one action". The session LIST cannot offer this — job_state folds
  // `budget`, a user stop and `no_progress` all into `stopped`, so it cannot tell a
  // spend stop apart. ChatPane sees the `turn_done` outcome, so the action lives here.

  function mountWith(props: { projectId?: string }): FakeConn {
    const conn = new FakeConn()
    render(
      <ChatPane
        conn={conn}
        sessionId="sess_1"
        isNew={false}
        projectId={props.projectId}
        onContinueOnProject={() => {}}
      />
    )
    conn.emit({ type: 'status', state: 'chat_ready' })
    return conn
  }

  // The real wire shape, learned the hard way: a `turn_done` arrives NESTED in an
  // `agent_event` envelope, and only after a turn has started. My first two versions
  // emitted a bare frame, so nothing reached the component — and the two negative
  // cases passed vacuously, because no outcome was ever set. Only the positive case
  // noticed. `startTurn` and the envelope are what the existing outcome tests use.
  const continueButton = (): HTMLElement | null =>
    screen.queryByRole('button', { name: /continue on this project/i })

  it('offers nothing on an ordinary stop', () => {
    const conn = mountWith({ projectId: 'proj_1' })
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'stopped' } })
    expect(continueButton()).toBeNull()
  })

  it('offers the continue action on a spend stop', () => {
    const conn = mountWith({ projectId: 'proj_1' })
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'budget', limit: 'spend' } })
    // Label first: if the frame never reached the component, that is a different
    // failure from the button not rendering.
    expect(screen.getByText(SPEND_CAP_LABEL, { exact: false })).toBeTruthy()
    expect(continueButton()).not.toBeNull()
  })

  it('offers nothing on a budget stop that is NOT the spend bound', () => {
    // `budget` without `limit: 'spend'` is a different bound, and the clause is about
    // the spend one. Dropping `&& ev.limit === 'spend'` reds this and nothing else —
    // the ordinary-stop case above uses `stopped` and never exercised it.
    const conn = mountWith({ projectId: 'proj_1' })
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'budget' } })
    expect(continueButton()).toBeNull()
  })

  it('offers nothing when the project id is unknown', () => {
    // An older server omits project_id. Offering the button then would open a session
    // on a NEW project, which is the opposite of what the clause asks for.
    const conn = mountWith({})
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'budget', limit: 'spend' } })
    expect(continueButton()).toBeNull()
  })
})

describe('the agent compacting its context', () => {
  // Measured on the committed corpus: every long run compacts, a median three times at
  // about two minutes each — roughly six minutes per run with NOTHING on screen. A
  // researcher cannot tell a working pause from a crash, which is the most likely way a
  // working run reads as a broken one. Ruled build-it by the lead, 2026-10-13.

  function mounted(): FakeConn {
    const conn = new FakeConn()
    render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
    conn.emit({ type: 'status', state: 'chat_ready' })
    return conn
  }

  it('says it is still there while compacting', () => {
    const conn = mounted()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'compaction', trigger: 'auto' } })
    expect(screen.getByText(COMPACTING_LABEL, { exact: false })).toBeTruthy()
  })

  it('clears the notice as soon as anything else happens', () => {
    // The CLI announces the START of a compaction and never its end, so the notice has
    // to be cleared by evidence of progress. Without that it would sit there for the
    // rest of the turn.
    const conn = mounted()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'compaction', trigger: 'auto' } })
    expect(screen.getByText(COMPACTING_LABEL, { exact: false })).toBeTruthy()
    conn.emit({ type: 'agent_event', event: { kind: 'text', text: 'Back to work.' } })
    expect(screen.queryByText(COMPACTING_LABEL, { exact: false })).toBeNull()
  })

  it('says nothing when no compaction happened', () => {
    const conn = mounted()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'text', text: 'Searching.' } })
    expect(screen.queryByText(COMPACTING_LABEL, { exact: false })).toBeNull()
  })

  it('a lost connection outranks a working pause', () => {
    // Both are "the screen is not moving"; only one of them is a problem.
    const conn = mounted()
    startTurn(conn)
    conn.emit({ type: 'agent_event', event: { kind: 'compaction', trigger: 'auto' } })
    conn.emit({ type: 'conn_state', state: 'reconnecting' })
    expect(screen.getByText(/Reconnecting/)).toBeTruthy()
    expect(screen.queryByText(COMPACTING_LABEL, { exact: false })).toBeNull()
  })
})

describe('Phase 3 item 1: the decision card, through the real component', () => {
  // `summary` is deliberately NOT the question text -- the tool chip renders
  // `ev.summary` verbatim too, and a shared string makes `getByText` ambiguous
  // between the chip and the card.
  const QUESTION_EVENT = {
    kind: 'tool_use',
    tool: 'AskUserQuestion',
    summary: 'asking which Mary Hales',
    questions: [
      {
        question: 'Which Mary Hales?',
        header: 'Person',
        options: [
          { label: 'Mary Hales of Ohio (Recommended)', description: 'b. 1832' },
          { label: 'Mary Hales of Indiana', description: 'b. 1841' }
        ]
      }
    ]
  }

  function askAndEndInDecision(conn: FakeConn): void {
    conn.emit({ type: 'agent_event', event: QUESTION_EVENT })
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'decision' } })
  }

  it('shows the card, not the one-line label, when a turn ends in decision', () => {
    const { conn } = mount()
    startTurn(conn)
    askAndEndInDecision(conn)
    expect(screen.getByText('Which Mary Hales?')).toBeTruthy()
    expect(screen.queryByText(TURN_OUTCOME_LABELS.decision)).toBeNull()
  })

  it('answering removes the card immediately, before the next turn starts', () => {
    const { conn } = mount()
    startTurn(conn)
    askAndEndInDecision(conn)
    fireEvent.click(screen.getByRole('button', { name: /Indiana/ }))
    expect(screen.queryByText('Which Mary Hales?')).toBeNull()
    expect(conn.sent.at(-1)).toMatchObject({ type: 'user_msg', text: 'Mary Hales of Indiana' })
    // Not just the card -- the one-line label it replaced must not flash back in
    // its place. Answering goes through the same path a typed reply does, which
    // sets `busy` and clears the old outcome right away rather than waiting for
    // `turn_active` to arrive over the wire.
    expect(screen.queryByText(TURN_OUTCOME_LABELS.decision)).toBeNull()
  })

  it('a later ordinary outcome does not resurrect the already-answered card', () => {
    // The bug: `m0Decision` searched BACKWARD across the whole transcript for any
    // message that ever carried `.decision`, so once the new turn's own last message
    // carried none (the ordinary case), the stale prior decision reappeared under a
    // later, unrelated outcome -- nothing had ever marked it as answered.
    const { conn } = mount()
    startTurn(conn)
    askAndEndInDecision(conn)
    fireEvent.click(screen.getByRole('button', { name: /Indiana/ }))
    conn.emit({ type: 'agent_event', event: { kind: 'text', text: 'Found it.' } })
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'completed' } })
    expect(screen.queryByText('Which Mary Hales?')).toBeNull()
    expect(screen.getByText(TURN_OUTCOME_LABELS.completed)).toBeTruthy()
  })

  it('"something else" dismisses the card without sending anything', () => {
    const { conn } = mount()
    startTurn(conn)
    askAndEndInDecision(conn)
    const sentBefore = conn.sent.length
    fireEvent.click(screen.getByRole('button', { name: /something else/i }))
    expect(screen.queryByText('Which Mary Hales?')).toBeNull()
    expect(conn.sent).toHaveLength(sentBefore)
    // The composer was always there; dismissing just stops hiding it behind the card.
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('a fresh decision in a LATER turn still shows the card after an earlier one was dismissed', () => {
    // The dismissal is per-turn, not permanent: it must reset once a genuinely new
    // turn ends, or every decision for the rest of the session would render nothing.
    const { conn } = mount()
    startTurn(conn)
    askAndEndInDecision(conn)
    fireEvent.click(screen.getByRole('button', { name: /something else/i }))
    expect(screen.queryByText('Which Mary Hales?')).toBeNull()

    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'try the 1860 census instead' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    conn.emit({
      type: 'agent_event',
      event: {
        kind: 'tool_use',
        tool: 'AskUserQuestion',
        summary: 'asking which county',
        questions: [{ question: 'Which county?', options: [{ label: 'Franklin' }] }]
      }
    })
    conn.emit({ type: 'agent_event', event: { kind: 'turn_done', outcome: 'decision' } })
    expect(screen.getByText('Which county?')).toBeTruthy()
  })
})
