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
import { expandFirstCard } from './expandCard'

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

  it('renders a legitimate zero score rather than hiding the row', async () => {
    // `minimum: 0` in the schema, so 0 is the bottom of the valid range, not a
    // sentinel. It is the one value where `!= null` and truthiness disagree, and
    // truthiness is the tempting "simplification" here: `{pe.match_score && ...}`
    // compiles, passes every other case, and silently drops the row for a real
    // 0% match. Without this case that mutation is green.
    mockResearch(withMatchScore(0))
    render(<PersonEvidenceSection />)
    await expandFirstCard()
    expect(screen.getByText('Match:')).toBeInTheDocument()
    expect(screen.getByText(/0%/)).toBeInTheDocument()
  })

  it('renders the rounded percentage when a score is present', async () => {
    mockResearch(withMatchScore(0.875))
    render(<PersonEvidenceSection />)
    await expandFirstCard()
    expect(screen.getByText('Match:')).toBeInTheDocument()
    expect(screen.getByText(/88%/)).toBeInTheDocument()
  })
})
