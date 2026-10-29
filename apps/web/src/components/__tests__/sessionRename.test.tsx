import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import SessionView from '../SessionView'
import { api, ApiError, type SessionSummary } from '../../api'
import { makeSessionConnection } from '../../transport/makeSessionConnection'
import type { SessionConnection, Listener } from '../../transport/SessionConnection'

const viewer = vi.hoisted(() => ({ onProjectTitle: undefined as ((title: string | null) => void) | undefined }))

vi.mock('@genealogy/viewer-ui', () => ({
  ViewerBody: ({ onProjectTitle }: { onProjectTitle?: (title: string | null) => void }) => {
    viewer.onProjectTitle = onProjectTitle
    return null
  },
  ResearchDataProvider: ({ children }: { children?: unknown }) => children,
  useResearchDataOptional: () => null,
  resolveFamilySearchTarget: () => null
}))

vi.mock('../../transport/makeSessionConnection', () => ({
  makeSessionConnection: vi.fn(),
  sessionLogsAvailable: () => false
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
}

const SESSION = {
  id: 'sess_1',
  title: 'Research',
  model: 'claude-sonnet-4-6'
} as SessionSummary

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  viewer.onProjectTitle = undefined
  vi.spyOn(api, 'resumeSession').mockResolvedValue(SESSION)
  vi.mocked(makeSessionConnection).mockResolvedValue(new FakeConn())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SessionView rename', () => {
  it('saves the header name and displays the returned title', async () => {
    const patch = vi.spyOn(api, 'patchSession').mockResolvedValue({ ...SESSION, title: 'Smith family (saved)' })
    render(<SessionView sessionId="sess_1" isNew={false} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Research' }))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    fireEvent.change(input, { target: { value: 'Smith family' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('button', { name: 'Smith family (saved)' })).toBeTruthy()
    expect(patch).toHaveBeenCalledExactlyOnceWith('sess_1', { title: 'Smith family' })
    expect(screen.queryByLabelText('Session name')).toBeNull()
  })

  it('shows a header rename refusal, keeps the title, and clears the error on reopen', async () => {
    const detail = "A session name can't be blank."
    vi.spyOn(api, 'patchSession').mockRejectedValue(new ApiError(400, detail))
    render(<SessionView sessionId="sess_1" isNew={false} onBack={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Research' }))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    fireEvent.change(input, { target: { value: 'Smith family' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(detail)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Research' }))
    expect(screen.queryByText(detail)).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Session name' }) as HTMLInputElement).value).toBe('Research')
  })

  it('relays an agent title only if the stored session still has the default name', async () => {
    vi.mocked(api.resumeSession).mockResolvedValue({ ...SESSION, title: 'New research session' })
    // A manual rename won on the server before the relay reached it.
    const patch = vi.spyOn(api, 'patchSession').mockResolvedValue({ ...SESSION, title: 'My family' })
    render(<SessionView sessionId="sess_1" isNew={false} onBack={() => {}} />)
    await screen.findByRole('button', { name: 'New research session' })
    await waitFor(() => expect(viewer.onProjectTitle).toBeTypeOf('function'))
    act(() => viewer.onProjectTitle?.('Agent title'))
    expect(patch).toHaveBeenCalledExactlyOnceWith('sess_1', { title_if_default: 'Agent title' })
    expect(await screen.findByRole('button', { name: 'My family' })).toBeTruthy()
    act(() => viewer.onProjectTitle?.('Later agent title'))
    expect(patch).toHaveBeenCalledTimes(1)
  })
})
