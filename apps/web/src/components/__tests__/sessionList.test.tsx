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
