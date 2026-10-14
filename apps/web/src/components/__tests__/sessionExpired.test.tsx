import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import ChatPane, { SESSION_EXPIRED_TEXT } from '../ChatPane'
import SessionList from '../SessionList'
import SessionView from '../SessionView'
import { api, ApiError, type SessionSummary } from '../../api'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'

// Issue #3406: a session more than 24 h old can be read but not continued. The
// transport turns /connect's 410 into one `session_expired` status; these check
// what the user then sees.

// The viewer is irrelevant here and heavy to mount.
vi.mock('@genealogy/viewer-ui', () => ({ App: () => null, resolveFamilySearchTarget: () => null }))

vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { email: 'dev@localhost' }, logout: vi.fn() })
}))

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

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChatPane on session_expired', () => {
  it('replaces the composer and the "Connecting" placeholder with the notice', () => {
    const conn = new FakeConn()
    render(<ChatPane conn={conn} sessionId="sess_old" isNew={false} />)
    expect(screen.getByRole('textbox')).toBeTruthy()
    // A tab left open past 24 h: the socket dropped, so it was reconnecting.
    conn.emit({ type: 'conn_state', state: 'reconnecting' })
    expect(screen.getByText(/Reconnecting/)).toBeTruthy()

    // A message unlike the built-in fallback, so the server's text is what shows.
    conn.emit({ type: 'status', state: 'session_expired', message: 'Too old (from the server).' })

    expect(screen.getByText('Too old (from the server).')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText('Attach a document or image')).toBeNull()
    expect(screen.queryByText('Connecting to the agent…')).toBeNull()
    expect(screen.queryByText(/Reconnecting/)).toBeNull()
  })
})

const row = (continuable: boolean | undefined): SessionSummary =>
  ({
    id: `sess_${String(continuable)}`,
    title: `Research ${String(continuable)}`,
    model: 'claude-sonnet-4-6',
    last_active: new Date().toISOString(),
    ...(continuable === undefined ? {} : { continuable })
  }) as unknown as SessionSummary

describe('SessionList "ended" pill', () => {
  it('shows only on a row with continuable === false', async () => {
    vi.spyOn(api, 'listSessions').mockResolvedValue([row(false), row(true), row(undefined)])
    render(<SessionList onOpen={vi.fn()} />)
    await screen.findByText('Research false')
    const ended = screen.getAllByText('ended')
    expect(ended).toHaveLength(1)
    expect(ended[0].closest('li')?.textContent).toContain('Research false')
  })
})

describe('SessionView with an immediate 410 (the real mount order)', () => {
  // SessionView calls connect() before ChatPane subscribes, and a refused
  // /connect returns before any sandbox work -- often inside the first render.
  // Every other test here attaches its listener first; this one does not.
  it('still shows the notice, not an endless "Connecting to the agent…"', async () => {
    vi.spyOn(api, 'resumeSession').mockResolvedValue({ id: 's', title: 't', model: 'm' } as never)
    vi.spyOn(api, 'connectSession').mockRejectedValue(new ApiError(410, SESSION_EXPIRED_TEXT))
    render(<SessionView sessionId="s" isNew={false} onBack={() => {}} />)
    expect(await screen.findByText(SESSION_EXPIRED_TEXT)).toBeTruthy()
    expect(screen.queryByText('Connecting to the agent…')).toBeNull()
  })
})
