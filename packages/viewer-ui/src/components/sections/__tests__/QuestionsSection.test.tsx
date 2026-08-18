import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import QuestionsSection from '../QuestionsSection'
import type { Question, ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'questions'
    })
  )
}

describe('QuestionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Regression guard on the read path: the selected research question reaches the
  // viewer (issue #1317 symptom #2).
  it('renders the recorded research question', () => {
    mockResearch()
    render(<QuestionsSection />)
    expect(
      screen.getByText('Who were the parents of Patrick Flynn (b. ~1845, PA, d. 1908)?')
    ).toBeInTheDocument()
  })

  it('shows the empty state when there are no questions', () => {
    mockResearch({ questions: [] })
    render(<QuestionsSection />)
    expect(screen.getByText('No questions defined yet.')).toBeInTheDocument()
  })

  // A question missing exhaustive_declaration and its array fields must not throw
  // (issue #1317: a partial item previously white-screened the viewer).
  it('renders a question missing exhaustive_declaration and array fields without throwing', () => {
    const malformed = {
      id: 'q_bad',
      question: 'A question with no declaration or arrays',
      status: 'active',
      priority: 'high',
      selection_basis: 'lowest_hanging_fruit',
      rationale: 'test',
      created: '2026-01-01'
      // no exhaustive_declaration, depends_on, unblocks, resolution_assertion_ids
    } as unknown as Question
    mockResearch({ questions: [malformed] })
    expect(() => render(<QuestionsSection />)).not.toThrow()
    expect(screen.getByText('A question with no declaration or arrays')).toBeInTheDocument()
  })
})
