import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConflictsSection from '../ConflictsSection'
import type { Conflict, ResearchData } from '../../../lib/schema'
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
      activeSection: 'conflicts'
    })
  )
}

describe('ConflictsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Regression guard on the already-correct read path: a recorded conflict, with
  // its resolution, reaches the viewer (issue #1317 symptom #1). Not the issue's
  // end-to-end acceptance — it pins that a future serialization change can't drop
  // conflicts silently.
  it('renders a recorded conflict with its resolution rationale', async () => {
    mockResearch()
    render(<ConflictsSection />)
    const title = screen.getByText(
      "Patrick Flynn's birthplace: Ireland (censuses) vs. Pennsylvania (death certificate)"
    )
    expect(title).toBeInTheDocument()
    // Body (with the resolution) is collapsed until the card header is clicked.
    await userEvent.click(title.parentElement as HTMLElement)
    expect(screen.getByText('Resolution Rationale')).toBeInTheDocument()
    expect(screen.getByText(/Ireland is accepted/)).toBeInTheDocument()
  })

  it('shows the empty state when there are no conflicts', () => {
    mockResearch({ conflicts: [] })
    render(<ConflictsSection />)
    expect(screen.getByText('No conflicts recorded.')).toBeInTheDocument()
  })

  // A conflict missing its array fields must not throw (issue #1317: a
  // partial/malformed item previously took down the whole viewer). The `?? []`
  // guards keep the section rendering.
  it('renders a conflict missing its array fields without throwing', () => {
    const malformed = {
      id: 'c_bad',
      conflict_type: 'fact',
      description: 'A conflict with no array fields',
      status: 'unresolved'
      // no competing_assertion_ids, no blocks_question_ids
    } as unknown as Conflict
    mockResearch({ conflicts: [malformed] })
    expect(() => render(<ConflictsSection />)).not.toThrow()
    expect(screen.getByText('A conflict with no array fields')).toBeInTheDocument()
  })
})
