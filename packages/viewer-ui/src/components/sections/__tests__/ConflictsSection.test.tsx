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

  it('renders how a resolution was settled, in words, and its resolved value', async () => {
    const synthesized = {
      ...patrickFlynnResearch.conflicts[0],
      id: 'c_syn',
      description: 'A synthesized birth year',
      resolution_kind: 'synthesis',
      resolved_value: 'about 1845'
    } as Conflict
    mockResearch({ conflicts: [synthesized] })
    render(<ConflictsSection />)
    await userEvent.click(screen.getByText('A synthesized birth year').parentElement as HTMLElement)
    expect(screen.getByText('Resolved As')).toBeInTheDocument()
    expect(screen.getByText('A value built from several records')).toBeInTheDocument()
    expect(screen.getByText('about 1845')).toBeInTheDocument()
  })

  it('omits both when a conflict was resolved before the fields existed', async () => {
    mockResearch()
    render(<ConflictsSection />)
    await userEvent.click(
      screen.getByText(
        "Patrick Flynn's birthplace: Ireland (censuses) vs. Pennsylvania (death certificate)"
      ).parentElement as HTMLElement
    )
    expect(screen.queryByText('Resolved As')).not.toBeInTheDocument()
    expect(screen.queryByText('Resolved Value')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no conflicts', () => {
    mockResearch({ conflicts: [] })
    render(<ConflictsSection />)
    expect(screen.getByText(/No conflicts recorded\./)).toBeInTheDocument()
    expect(screen.getByText(/conflict-resolution step/)).toBeInTheDocument()
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
