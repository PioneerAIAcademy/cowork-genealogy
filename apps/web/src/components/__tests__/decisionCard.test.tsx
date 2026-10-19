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

  // Should-fix 11.1: `AskUserQuestion` allows 1-4 questions in one call. A card
  // built from only `questions[0]` silently drops every question after the first.
  const TWO_QUESTIONS = [
    {
      question: 'Which Mary Hales?',
      header: 'Person',
      options: [
        { label: 'Mary Hales of Ohio (Recommended)', description: 'b. 1832' },
        { label: 'Mary Hales of Indiana', description: 'b. 1841' }
      ]
    },
    {
      question: 'Which county?',
      header: 'Place',
      options: [
        { label: 'Franklin (Recommended)', description: 'matches the deed' },
        { label: 'Licking', description: 'matches the census only' }
      ]
    }
  ]

  it('shows every question in the call, not just the first', () => {
    const { container } = render(<DecisionCard questions={TWO_QUESTIONS} onAnswer={vi.fn()} />)
    const w = within(container)
    expect(w.getByText('Which Mary Hales?')).toBeTruthy()
    expect(w.getByText('Which county?')).toBeTruthy()
    expect(container.textContent).toContain('Franklin')
    expect(container.textContent).toContain('Licking')
  })

  it('joins answers to every question into one message once the last is picked', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<DecisionCard questions={TWO_QUESTIONS} onAnswer={onAnswer} />)
    const w = within(container)
    await userEvent.click(w.getByRole('button', { name: /Indiana/ }))
    // Not yet -- the second question is still unanswered.
    expect(onAnswer).not.toHaveBeenCalled()
    await userEvent.click(w.getByRole('button', { name: /Licking/ }))
    expect(onAnswer).toHaveBeenCalledWith('Person: Mary Hales of Indiana\nPlace: Licking')
  })

  it('answers a two-question card with "not sure" on each, one at a time', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<DecisionCard questions={TWO_QUESTIONS} onAnswer={onAnswer} />)
    const notSure = (): HTMLElement => within(container).getAllByRole('button', { name: /not sure/i })[0]
    await userEvent.click(notSure())
    expect(onAnswer).not.toHaveBeenCalled()
    await userEvent.click(notSure())
    expect(onAnswer).toHaveBeenCalledWith('Person: Mary Hales of Ohio\nPlace: Franklin')
  })

  it('has exactly one "something else" escape for a multi-question card, not one per question', () => {
    const { container } = render(<DecisionCard questions={TWO_QUESTIONS} onAnswer={vi.fn()} />)
    expect(within(container).getAllByRole('button', { name: /something else/i })).toHaveLength(1)
  })

  // Should-fix 11.3: "something else" used to send a canned placeholder the instant
  // it was clicked, before the researcher had written any explanation.
  it('"something else" dismisses locally instead of answering', async () => {
    const onAnswer = vi.fn()
    const onSomethingElse = vi.fn()
    const { container } = render(
      <DecisionCard questions={QUESTIONS} onAnswer={onAnswer} onSomethingElse={onSomethingElse} />
    )
    await userEvent.click(within(container).getByRole('button', { name: /something else/i }))
    expect(onSomethingElse).toHaveBeenCalledTimes(1)
    expect(onAnswer).not.toHaveBeenCalled()
  })
})
