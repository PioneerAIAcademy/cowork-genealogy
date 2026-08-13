import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackDialog from '../FeedbackDialog'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'

function mount(): { submitFeedback: ReturnType<typeof vi.fn> } {
  const submitFeedback = vi.fn(async () => ({ ok: true as const }))
  vi.mocked(useResearchData).mockReturnValue({ ...buildMockContext(), submitFeedback })
  render(<FeedbackDialog onClose={() => {}} />)
  return { submitFeedback }
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.clear(screen.getByLabelText('Your email'))
  await user.type(screen.getByLabelText('Your email'), 'a@b.com')
  await user.type(screen.getByLabelText('What you asked the agent to do'), 'q')
  await user.type(screen.getByLabelText('What the agent did'), 'd')
}

describe('FeedbackDialog — worked-as-expected gate', () => {
  // This repo's jsdom env doesn't expose a full Storage, so stub an in-memory one
  // (the dialog's own localStorage reads/writes are try/caught, but the test needs
  // a real clear() to isolate the remembered-email state between cases).
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks Send until the radio is answered, then allows it with no bug detail', async () => {
    const user = userEvent.setup()
    mount()
    await fillRequired(user)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('reveals the bug-detail fields only on No', async () => {
    const user = userEvent.setup()
    mount()
    expect(screen.queryByLabelText(/What it should have done/)).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'No' }))
    expect(screen.getByLabelText(/What it should have done/)).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByLabelText(/What it should have done/)).toBeNull()
  })

  it('does not carry stale bug text into a positive report', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await fillRequired(user)
    await user.click(screen.getByRole('radio', { name: 'No' }))
    await user.type(screen.getByLabelText(/What it should have done/), 'it should have searched 1870')
    await user.type(screen.getByLabelText(/what is the correct answer/), 'father was Robert')
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).toHaveBeenCalledTimes(1)
    const payload = submitFeedback.mock.calls[0][0] as Record<string, unknown>
    expect(payload.workedAsExpected).toBe(true)
    expect(payload.agentShouldHave).toBe('')
    expect(payload.correctAnswer).toBeUndefined()
  })
})
