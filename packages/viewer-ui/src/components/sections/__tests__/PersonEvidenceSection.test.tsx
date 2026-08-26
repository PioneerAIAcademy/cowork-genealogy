import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PersonEvidenceSection from '../PersonEvidenceSection'
import type { ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../../lib/__fixtures__/patrick-flynn'

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
      gedcomx: patrickFlynnGedcomx,
      activeSection: 'person-evidence'
    })
  )
}

/** The fixture's first entry, with `match_score` controllable per case. */
function withMatchScore(value: number | null | undefined): Partial<ResearchData> {
  const [first, ...rest] = patrickFlynnResearch.person_evidence!
  const entry: Record<string, unknown> = { ...first }
  if (value === undefined) delete entry.match_score
  else entry.match_score = value
  return { person_evidence: [entry, ...rest] } as Partial<ResearchData>
}

/**
 * `match_score` is optional in the schema and `packages/schema` types it `?:` per
 * ADR-0008, so an ABSENT key is legal and common: 1,539 of 7,392 committed
 * person_evidence entries omit it.
 *
 * tsc guards the narrowing itself (reverting `!= null` to `!== null` is TS18048),
 * but it cannot see what the component renders once someone satisfies the compiler
 * a different way. `!` is forbidden by the #1165 ruling, and `?? 0` compiles clean
 * while claiming "Match: 0%" for an entry that has no score. These pin the
 * behaviour, not the compile.
 */
describe('PersonEvidenceSection — match_score presence', () => {
  beforeEach(() => vi.clearAllMocks())

  /**
   * The Match row lives in the Card body, and Card starts collapsed
   * (`shared/Card.tsx`: `useState(false)`, body rendered only when expanded).
   * Target the card by its id rather than by rendered text, which the person-name
   * lookup can split across elements.
   */
  async function expandFirstCard(): Promise<void> {
    const card = document.getElementById('pe_001')
    expect(card, 'no card rendered for pe_001').not.toBeNull()
    await userEvent.click(card!.firstElementChild as HTMLElement)
  }

  it('omits the Match row when the key is absent, without rendering NaN', async () => {
    mockResearch(withMatchScore(undefined))
    expect(() => render(<PersonEvidenceSection />)).not.toThrow()
    await expandFirstCard()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.queryByText('Match:')).not.toBeInTheDocument()
  })

  it('omits the Match row when the value is null', async () => {
    mockResearch(withMatchScore(null))
    render(<PersonEvidenceSection />)
    await expandFirstCard()
    expect(screen.queryByText('Match:')).not.toBeInTheDocument()
  })

  it('renders the rounded percentage when a score is present', async () => {
    mockResearch(withMatchScore(0.875))
    render(<PersonEvidenceSection />)
    await expandFirstCard()
    expect(screen.getByText('Match:')).toBeInTheDocument()
    expect(screen.getByText(/88%/)).toBeInTheDocument()
  })
})
