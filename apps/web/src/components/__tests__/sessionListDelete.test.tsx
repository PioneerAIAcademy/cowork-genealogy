import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SessionList from '../SessionList'
import { api, ApiError, type SessionSummary } from '../../api'

// U19: the prototype's DELETE answers 409 while a turn is running. The list awaited the
// delete with no catch, so a refusal was an unhandled rejection and the patron saw nothing.

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
    const detail = 'A turn is still open on this session; press Stop, and try again once it has ended'
    const del = vi.spyOn(api, 'deleteSession').mockRejectedValue(new ApiError(409, detail))
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Delete session'))
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(del).toHaveBeenCalledWith('sess_1')
    expect(screen.getByText('Research')).toBeTruthy()
  })

  it('reloads the list after a delete that succeeds, with no error', async () => {
    vi.spyOn(api, 'deleteSession').mockResolvedValue({ ok: true })
    render(<SessionList onOpen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Delete session'))
    await waitFor(() => expect(api.listSessions).toHaveBeenCalledTimes(2))
    expect(document.querySelector('.bannerError')).toBeNull()
  })
})
