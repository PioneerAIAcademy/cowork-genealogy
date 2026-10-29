import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SessionList from '../SessionList'
import { api, ApiError, type SessionSummary } from '../../api'

// U19, the prototype backend's session list. Its DELETE answers 409 while a turn may still be
// running, and the list awaited the delete with no catch, so a refusal was an unhandled
// rejection the patron never saw. A retired (expired) session takes no message, and its
// research goes on only in a new session on its project, which the card offers.

vi.mock('../../auth', () => ({
  useAuth: () => ({ user: { email: 'dev@localhost' }, logout: vi.fn() })
}))

const SESSION = {
  id: 'sess_1',
  title: 'Research',
  model: 'claude-sonnet-4-6',
  last_active: new Date().toISOString()
} as unknown as SessionSummary

beforeEach(() => {
  vi.spyOn(api, 'listSessions').mockResolvedValue([SESSION])
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SessionList delete', () => {
  it('shows the refusal and keeps the session when the delete is refused', async () => {
    const detail = 'A turn is still running on this session; press Stop, and try again once it has ended'
    const del = vi.spyOn(api, 'deleteSession').mockRejectedValue(new ApiError(409, detail))
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Delete session'))
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(del).toHaveBeenCalledWith('sess_1')
    expect(screen.getByText('Research')).toBeTruthy()
  })

  it('continues a retired session on its project in a new session, and opens it', async () => {
    vi.mocked(api.listSessions).mockResolvedValue([{ ...SESSION, status: 'retired', continuable: false }])
    const cont = vi.spyOn(api, 'continueSession').mockResolvedValue({ ...SESSION, id: 'sess_2', status: 'active' })
    const onOpen = vi.fn()
    render(<SessionList onOpen={onOpen} />)
    fireEvent.click(await screen.findByText('Continue in a new session'))
    expect(screen.getByText('ended')).toBeTruthy()
    expect(screen.queryByText('expired')).toBeNull()
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('sess_2'))
    expect(cont).toHaveBeenCalledWith('sess_1')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('offers no continue on a session that has not expired', async () => {
    render(<SessionList onOpen={vi.fn()} />)
    await screen.findByText('Research')
    expect(screen.queryByText('Continue in a new session')).toBeNull()
  })

  it('reloads the list after a delete that succeeds, with no error', async () => {
    vi.spyOn(api, 'deleteSession').mockResolvedValue({ ok: true })
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Delete session'))
    await waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(2))
    expect(document.querySelector('.bannerError')).toBeNull()
  })
})

describe('SessionList rename', () => {
  it('saves once on Enter and blur, shows the returned name, and never opens the card', async () => {
    let resolveSave!: (session: SessionSummary) => void
    const patch = vi.spyOn(api, 'patchSession').mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
    const onOpen = vi.fn()
    render(<SessionList onOpen={onOpen} />)
    fireEvent.click(await screen.findByTitle('Rename session'))
    const input = screen.getByRole('textbox', { name: 'Session name' }) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(SESSION.title.length)
    expect(input.maxLength).toBe(120)
    fireEvent.mouseDown(input)
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '  Smith family  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(patch).toHaveBeenCalledExactlyOnceWith('sess_1', { title: 'Smith family' })
    resolveSave({ ...SESSION, title: 'Smith family (saved)' })
    expect(await screen.findByText('Smith family (saved)')).toBeTruthy()
    expect(screen.queryByLabelText('Session name')).toBeNull()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('cancels on Escape without sending or changing the title', async () => {
    const patch = vi.spyOn(api, 'patchSession').mockResolvedValue(SESSION)
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Rename session'))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    fireEvent.change(input, { target: { value: 'Discard this' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByLabelText('Session name')).toBeNull()
    expect(patch).not.toHaveBeenCalled()
    expect(screen.getByText('Research')).toBeTruthy()
  })

  it('cancels blank or unchanged names without sending', async () => {
    const patch = vi.spyOn(api, 'patchSession').mockResolvedValue(SESSION)
    render(<SessionList onOpen={vi.fn()} />)
    for (const value of ['', '   ', '  Research  ']) {
      fireEvent.click(await screen.findByTitle('Rename session'))
      const input = screen.getByRole('textbox', { name: 'Session name' })
      fireEvent.change(input, { target: { value } })
      fireEvent.blur(input)
      expect(patch).not.toHaveBeenCalled()
      expect(screen.queryByLabelText('Session name')).toBeNull()
      expect(screen.getByText('Research')).toBeTruthy()
    }
  })

  it('shows a rename refusal and keeps the old title', async () => {
    const detail = "A session name can't be blank."
    const patch = vi.spyOn(api, 'patchSession').mockRejectedValue(new ApiError(400, detail))
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Rename session'))
    const input = screen.getByRole('textbox', { name: 'Session name' })
    fireEvent.change(input, { target: { value: 'Smith family' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(patch).toHaveBeenCalledExactlyOnceWith('sess_1', { title: 'Smith family' })
    expect(screen.getByText('Research')).toBeTruthy()
    expect(screen.queryByLabelText('Session name')).toBeNull()
  })
})
