import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

// Label queries are regex, not exact strings: three of these labels carry an
// "(optional)" tag, which is part of the accessible name.
async function fillOptionalText(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.clear(screen.getByLabelText(/Your email/))
  await user.type(screen.getByLabelText(/Your email/), 'a@b.com')
  await user.type(screen.getByLabelText(/What you asked the agent to do/), 'q')
  await user.type(screen.getByLabelText(/What the agent did/), 'd')
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

  it('keeps Send clickable with the radio unanswered, and says why nothing was sent', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await fillOptionalText(user)

    // The defect this replaces: Send sat disabled here with no explanation, and
    // the reporter could not tell a missing field from a broken app (#1919).
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeEnabled()
    await user.click(send)

    expect(submitFeedback).not.toHaveBeenCalled()
    expect(screen.getAllByText(/Choose Yes or No/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Not sent\./)).toBeTruthy()

    // Answering it clears the message and lets the send through.
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByText(/Choose Yes or No/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).toHaveBeenCalledTimes(1)
  })

  it('puts the cursor on the first blocking field, in render order', async () => {
    const user = userEvent.setup()
    mount()
    // Two blockers at once: a malformed email (renders first) and the unanswered
    // radio. The refused Send must land on the email, not on whichever check ran
    // last — that ordering is what FIELD_ORDER exists for.
    await user.clear(screen.getByLabelText(/Your email/))
    await user.type(screen.getByLabelText(/Your email/), 'nope')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(document.activeElement).toBe(screen.getByLabelText(/Your email/))

    // With the email fixed, the radio is the only thing left and gets the cursor.
    await user.clear(screen.getByLabelText(/Your email/))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Yes' }))
    // Focusing a radio must not answer it for the reporter.
    expect(screen.getByRole('radio', { name: 'Yes' })).not.toBeChecked()
  })

  it('marks the radio required and the three relaxed fields optional', async () => {
    mount()
    expect(screen.getByLabelText(/Your email \(optional\)/)).toBeTruthy()
    expect(screen.getByLabelText(/What you asked the agent to do \(optional\)/)).toBeTruthy()
    expect(screen.getByLabelText(/What the agent did \(optional\)/)).toBeTruthy()
    expect(screen.getByText(/Did it work as expected\?/).textContent).toContain('(required)')
  })

  it('submits with every optional box blank', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await user.clear(screen.getByLabelText(/Your email/))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(submitFeedback).toHaveBeenCalledTimes(1)
    const payload = submitFeedback.mock.calls[0][0] as Record<string, unknown>
    expect(payload.email).toBe('')
    expect(payload.userPrompt).toBe('')
    expect(payload.agentDid).toBe('')
    expect(payload.workedAsExpected).toBe(true)
  })

  it('refuses a malformed email but accepts a blank one', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await user.clear(screen.getByLabelText(/Your email/))
    await user.type(screen.getByLabelText(/Your email/), 'not-an-email')
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(submitFeedback).not.toHaveBeenCalled()
    expect(screen.getAllByText(/does not look like an email address/).length).toBeGreaterThan(0)

    // Clearing it is a valid resolution — anonymous submission is allowed.
    await user.clear(screen.getByLabelText(/Your email/))
    expect(screen.queryByText(/does not look like an email address/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).toHaveBeenCalledTimes(1)
  })

  it('shows nothing before the reporter has tried anything', async () => {
    mount()
    // The form must not open pre-marked red.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Not sent\./)).toBeNull()
    expect(screen.getByLabelText(/Your email/)).not.toHaveAttribute('aria-invalid')
  })

  it('does not go red for a field the reporter starts typing after a refusal', async () => {
    const user = userEvent.setup()
    mount()
    // Refuse on the radio, the issue's named likeliest omission, then fix it.
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText(/Not sent\./)).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))

    // Now start typing an email. Nothing has been refused about it, so nothing
    // may claim it was: a latched "we have shown errors" flag turns the field red
    // mid-keystroke and tells the reporter a send failed that never happened.
    await user.clear(screen.getByLabelText(/Your email/))
    await user.type(screen.getByLabelText(/Your email/), 'a')
    expect(screen.getByLabelText(/Your email/)).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/does not look like an email address/)).toBeNull()
    expect(screen.queryByText(/Not sent\./)).toBeNull()
  })

  it('clears a previous send failure when the next Send is refused', async () => {
    const user = userEvent.setup()
    const submitFeedback = vi.fn(async () => {
      throw new Error('BOOM upload failed')
    })
    vi.mocked(useResearchData).mockReturnValue({ ...buildMockContext(), submitFeedback })
    render(<FeedbackDialog onClose={() => {}} />)

    await user.clear(screen.getByLabelText(/Your email/))
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText(/BOOM upload failed/)).toBeTruthy()

    // Break something, then click again. The refusal must not stack under a
    // stale upload error that blames the wrong thing.
    await user.type(screen.getByLabelText(/Your email/), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText(/Not sent\./)).toBeTruthy()
    expect(screen.queryByText(/BOOM upload failed/)).toBeNull()
  })

  it('announces a refusal to assistive tech, not just visually', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const alerts = screen.getAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(2) // inline message + the toast
    expect(screen.getByRole('radiogroup')).toHaveAttribute(
      'aria-describedby',
      'feedback-worked-yes-error'
    )
  })

  it('refuses an over-limit field without ever disabling Send', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    // Typing 10,001 characters through userEvent is far too slow; set it directly.
    const notes = screen.getByLabelText(/Notes/)
    fireEvent.change(notes, { target: { value: 'x'.repeat(10_001) } })

    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeEnabled() // the #1919 invariant holds for length too
    await user.click(send)

    expect(submitFeedback).not.toHaveBeenCalled()
    // A refused click must say something. Before this test the length path was
    // silent: focus moved and nothing was announced.
    expect(screen.getByText(/Not sent\./)).toBeTruthy()
    expect(screen.getAllByText(/exceeds the 10,000-character limit/).length).toBeGreaterThan(0)
    expect(notes).toHaveAttribute('aria-invalid', 'true')
    expect(document.activeElement).toBe(notes)

    fireEvent.change(notes, { target: { value: 'short' } })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).toHaveBeenCalledTimes(1)
  })

  it('rejects an address that has an @ but is still not an address', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await user.clear(screen.getByLabelText(/Your email/))
    // 'a@b' has an @, so a regex weakened to /@/ would wrongly accept it.
    await user.type(screen.getByLabelText(/Your email/), 'a@b')
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).not.toHaveBeenCalled()
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
    await fillOptionalText(user)
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
