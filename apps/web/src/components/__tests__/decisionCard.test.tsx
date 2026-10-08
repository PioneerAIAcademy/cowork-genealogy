import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DecisionCard } from '../DecisionCard'

// Phase 3 item 1. Today a turn that ends `decision` renders one line -- "Waiting on
// you — see the question above" -- and the question itself is a truncated chip
// summary. This is the card: candidates side by side, each saying what happens if
// chosen, the way the Source Linker compares them.

const QUESTIONS = [
  {
    question: 'Which Mary Hales?',
    header: 'Person',
    options: [
      { label: 'Mary Hales of Ohio (Recommended)', description: 'b. 1832, matches the census' },
      { label: 'Mary Hales of Indiana', description: 'b. 1841, weaker match' }
    ]
  }
]

describe('DecisionCard', () => {
  it('shows the question and every option with what it would do', () => {
    const { container } = render(<DecisionCard questions={QUESTIONS} onAnswer={vi.fn()} />)
    const w = within(container)
    expect(w.getByText('Which Mary Hales?')).toBeTruthy()
    expect(container.textContent).toContain('b. 1832, matches the census')
    expect(container.textContent).toContain('b. 1841, weaker match')
  })

  it('marks the recommended option and does not print the marker twice', () => {
    const { container } = render(<DecisionCard questions={QUESTIONS} onAnswer={vi.fn()} />)
    // The badge carries the recommendation; the label must not also end in it.
    expect(container.textContent).toContain('Mary Hales of Ohio')
    expect(container.textContent).not.toContain('(Recommended)')
  })

  it('answers with the option the reader picked', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<DecisionCard questions={QUESTIONS} onAnswer={onAnswer} />)
    await userEvent.click(within(container).getByRole('button', { name: /Indiana/ }))
    expect(onAnswer).toHaveBeenCalledWith('Mary Hales of Indiana')
  })

  it('offers "not sure", and it answers with the RECOMMENDED option (R9)', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<DecisionCard questions={QUESTIONS} onAnswer={onAnswer} />)
    await userEvent.click(within(container).getByRole('button', { name: /not sure/i }))
    // Never "the weaker choice": *not sure* defers to the agent's judgement, and the
    // agent already weighed the evidence.
    expect(onAnswer).toHaveBeenCalledWith('Mary Hales of Ohio')
  })

  it('offers "something else" so the reader is not trapped in the options', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<DecisionCard questions={QUESTIONS} onAnswer={onAnswer} />)
    const other = within(container).queryByRole('button', { name: /something else/i })
    expect(other).toBeTruthy()
  })

  it('renders nothing when there are no questions', () => {
    const { container } = render(<DecisionCard questions={[]} onAnswer={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('survives an option list that is empty rather than rendering a dead card', () => {
    const { container } = render(
      <DecisionCard questions={[{ question: 'Q?', options: [] }]} onAnswer={vi.fn()} />
    )
    expect(container.textContent).toContain('Q?')
    expect(within(container).queryByRole('button', { name: /not sure/i })).toBeNull()
  })
})
