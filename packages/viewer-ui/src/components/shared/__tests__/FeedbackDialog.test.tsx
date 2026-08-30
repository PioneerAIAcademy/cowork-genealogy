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
    // last. NOTE: this pair alone does NOT exercise the sort — it is ordered the
    // same way by plain Map insertion order. The case below is the one that does.
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

  it('sorts the cursor by render order, not by the order blockers were found', async () => {
    const user = userEvent.setup()
    mount()
    // Notes is inserted into the blocker map BEFORE the radio, but renders
    // AFTER it. Insertion order would land the cursor on Notes; render order
    // must land it on the radio. This is the only pair that tells the two
    // apart, which is why deleting the sort used to leave the suite green.
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'x'.repeat(10_001) } })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Yes' }))
  })

  it('scrolls the offending field into view on a refused Send', async () => {
    const user = userEvent.setup()
    mount()
    // #1919's recommendation 3 is "on Send, scroll to it and say it is the one
    // thing still needed". jsdom cannot scroll, but vitest.setup.ts stubs the
    // method, so the call itself is assertable.
    const scrollIntoView = vi.mocked(window.HTMLElement.prototype.scrollIntoView)
    scrollIntoView.mockClear()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('says an over-limit field once, not inline and in the live toast too', async () => {
    const user = userEvent.setup()
    mount()
    const notes = screen.getByLabelText(/Notes/)
    fireEvent.change(notes, { target: { value: 'x'.repeat(10_001) } })
    // Before any refusal the live toast is the only channel.
    expect(screen.getAllByText(/exceeds the 10,000-character limit/)).toHaveLength(1)

    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    // After it, the message moves inline. Exactly one copy either way: dropping
    // the suppression renders it twice and a >0 assertion cannot see that.
    expect(screen.getAllByText(/exceeds the 10,000-character limit/)).toHaveLength(1)
    expect(notes).toHaveAttribute('aria-describedby', 'feedback-notes-error')
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

  // Every blockable control must carry its own inline message. Deleting any one
  // <FieldError> render site reproduces #1919 exactly and silently: nothing styles
  // aria-invalid, and untoldOverLimit suppresses the live toast for a refused id,
  // so the footer says "Fix the highlighted field above" with nothing highlighted.
  it('gives every refused field its own inline message, not just the three the other tests use', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('radio', { name: 'No' }))
    await user.clear(screen.getByLabelText(/Your email/))
    await user.type(screen.getByLabelText(/Your email/), 'nope')
    const over = 'x'.repeat(10_001)
    for (const id of ['feedback-prompt', 'feedback-did', 'feedback-should', 'feedback-answer', 'feedback-notes']) {
      fireEvent.change(document.getElementById(id)!, { target: { value: over } })
    }
    await user.click(screen.getByRole('button', { name: 'Send' }))
    for (const id of [
      'feedback-email',
      'feedback-prompt',
      'feedback-did',
      'feedback-should',
      'feedback-answer',
      'feedback-notes'
    ]) {
      expect(document.getElementById(id)).toHaveAttribute('aria-invalid', 'true')
      expect(document.getElementById(`${id}-error`)).not.toBeNull()
    }
  })

  // Email is the one field that can pass EMAIL_RE and still be rejected downstream,
  // where the web transport reports only "Failed to submit feedback" and names no
  // field. That was the last path to a refusal the reporter cannot act on.
  it('refuses an over-limit email inline instead of letting the backend reject it', async () => {
    const user = userEvent.setup()
    const { submitFeedback } = mount()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    fireEvent.change(screen.getByLabelText(/Your email/), {
      target: { value: `${'a'.repeat(10_000)}@b.co` }
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(submitFeedback).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/Your email/)).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById('feedback-email-error')?.textContent).toContain('10,000')
  })

  // What the two consent boxes SHOW must be what the bundle carries. A failed
  // lookup used to render them unticked and disabled reading "(none found)" while
  // handleSend submitted both flags true and each producer read the folder itself.
  it('says it could not check, rather than claiming an empty folder, when the lookup fails', async () => {
    const user = userEvent.setup()
    // Same loose typing as mount()'s mock, so mock.calls is indexable.
    const submitFeedback: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true as const }))
    vi.mocked(useResearchData).mockReturnValue({
      ...buildMockContext(),
      submitFeedback,
      getFeedbackContext: async () => {
        throw new Error('context unavailable')
      }
    })
    render(<FeedbackDialog onClose={() => {}} />)

    // The rejection lands in a microtask, so wait for the state it sets.
    expect(await screen.findAllByText('(could not check)')).toHaveLength(2)
    const media = screen.getByRole('checkbox', { name: /media/i })
    const log = screen.getByRole('checkbox', { name: /session log/i })
    expect(screen.queryByText('(none found)')).toBeNull()
    expect(screen.queryByText('(none in folder)')).toBeNull()
    expect(media).toBeChecked()
    expect(log).toBeChecked()
    expect(media).toBeEnabled()
    expect(log).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const payload = submitFeedback.mock.calls[0][0] as Record<string, unknown>
    // The boxes are ticked, so both must actually be requested.
    expect(payload.includeMedia).toBe(true)
    expect(payload.includeSessionLog).toBe(true)
  })

  it('does not go red for an untouched field while another is still refused', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getAllByText(/Choose Yes or No/).length).toBeGreaterThan(0)
    await user.clear(screen.getByLabelText(/Your email/))
    await user.type(screen.getByLabelText(/Your email/), 'a')
    expect(screen.getByLabelText(/Your email/)).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/does not look like an email address/)).toBeNull()
  })

  it('marks only the fields the refusal named, whatever kind the new breakage is', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    // Refused on the radio only. Now break a DIFFERENT field, of a different
    // kind (length, not format): nothing may claim it was refused.
    const notes = screen.getByLabelText(/Notes/)
    fireEvent.change(notes, { target: { value: 'x'.repeat(10_001) } })
    expect(notes).not.toHaveAttribute('aria-invalid')
  })

  it('does not go red again for a field that was refused, then fixed, then re-broken', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    const email = (): HTMLElement => screen.getByLabelText(/Your email/)
    await user.clear(email())
    await user.type(email(), 'nope')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    // The refusal names the email, so it is marked. This also pins the email's
    // aria-invalid, which nothing else asserts the presence of.
    expect(email()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Not sent\./)).toBeTruthy()

    // Fix it. Blank is a legitimate address, so the refusal clears.
    await user.clear(email())
    expect(email()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/Not sent\./)).toBeNull()

    // Re-break the SAME field with no Send in between. A refused id that is
    // never released turns the field red again and claims a refusal that did
    // not happen — the defect 9c284aaf fixed for a *new* field, still live for
    // one already refused once. 'a', 'a@', 'a@b' and 'a@b.' are all invalid, so
    // this is the whole way through an ordinary retype.
    await user.type(email(), 'a')
    expect(email()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(/Not sent\./)).toBeNull()
  })

  it('keeps showing a refusal the reporter has not fixed while they type elsewhere', async () => {
    const user = userEvent.setup()
    mount()
    // Refused on the radio, and never answered.
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getAllByText(/Choose Yes or No/).length).toBeGreaterThan(0)

    // Typing in an unrelated box must not release a blocker that is still live.
    // Releasing the whole refused set on any edit, rather than only the ids that
    // are now fixed, silently drops the message the reporter still needs.
    await user.type(screen.getByLabelText(/Notes/), 'something else')
    expect(screen.getAllByText(/Choose Yes or No/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Not sent\./)).toBeTruthy()

    // And it still clears the moment it is genuinely fixed.
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByText(/Choose Yes or No/)).toBeNull()
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
    // The upload failure is the case that LOSES the report, so it has to be
    // announced at least as loudly as a refusal, which is recoverable.
    expect(screen.getByRole('alert')).toHaveTextContent(/BOOM upload failed/)

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

describe('FeedbackDialog — publication notice', () => {
  // The feedback endpoint copies these fields into a public GitHub issue, so this
  // sentence is the only place a tester is told before typing. Nothing else would
  // catch its removal: every other test here passes with the dialog silent.
  it('tells the tester their comments are published, and the files are not', () => {
    mount()
    const notice = screen.getByText(/Comments are public/)
    expect(notice.textContent).toContain('the files you send are not')
    expect(notice.textContent).toContain("Don't include personal details")
  })

  it('shows the notice above the first field, not buried at the end', () => {
    mount()
    const notice = screen.getByText(/Comments are public/)
    const email = screen.getByLabelText(/Your email/)
    // eslint-disable-next-line no-bitwise
    const precedes = notice.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(precedes).toBeTruthy()
  })
})
