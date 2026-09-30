import { describe, it, expect } from 'vitest'
import { render, within } from '@testing-library/react'
import { JobStateBadge } from '../JobStateBadge'

// "That is the returning reader's one screen." The list showed only a title and a
// model pill, so a finished job, one waiting on you, and one that stopped at a cap
// all looked identical.

describe('JobStateBadge', () => {
  it('shows each of the four states in words a reader understands', () => {
    for (const [state, text] of [
      ['running', /working/i],
      ['needs you', /needs you/i],
      ['done', /done/i],
      ['stopped', /stopped/i]
    ] as const) {
      const { container } = render(<JobStateBadge state={state} />)
      expect(container.textContent).toMatch(text)
    }
  })

  it('renders nothing for a session that has never run', () => {
    // A brand-new session needs no badge; "new" as a label is noise on a list where
    // every row was new a moment ago.
    const { container } = render(<JobStateBadge state="new" />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the server did not send a state', () => {
    // An older server omits the field entirely. No badge beats a wrong badge.
    const { container } = render(<JobStateBadge state={undefined} />)
    expect(container.textContent).toBe('')
  })

  it('marks the two states that want attention differently from the two that do not', () => {
    const cls = (s: 'running' | 'needs you' | 'done' | 'stopped'): string => {
      const { container } = render(<JobStateBadge state={s} />)
      return within(container).getByText(/\w/).className
    }
    expect(cls('needs you')).not.toBe(cls('done'))
    expect(cls('running')).not.toBe(cls('stopped'))
  })
})
