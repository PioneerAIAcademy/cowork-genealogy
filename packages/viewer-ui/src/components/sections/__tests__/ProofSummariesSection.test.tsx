import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProofSummariesSection from '../ProofSummariesSection'
import type { ResearchData, ProofSummary } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'
import { expandFirstCard } from './expandCard'

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
      activeSection: 'proof_summaries',
      getById: (id: string) => {
        const q = (overrides.questions ?? patrickFlynnResearch.questions).find((q) => q.id === id)
        return q ? { section: 'questions', item: q } : null
      }
    })
  )
}

describe('ProofSummariesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a proof summary with its exhaustive search summary', () => {
    mockResearch()
    render(<ProofSummariesSection />)
    expect(screen.getByText(/Searched 1850 census/)).toBeInTheDocument()
  })

  it('shows the tier and shortfall as researcher-facing labels', () => {
    mockResearch()
    render(<ProofSummariesSection />)
    expect(screen.getByText('likely')).toBeInTheDocument()
    expect(screen.getByText('evidence missing')).toBeInTheDocument()
  })

  it('shows no shortfall badge when the shortfall is none, on the summary or a claim', async () => {
    const conclusive = {
      ...patrickFlynnResearch.proof_summaries[0],
      tier: 'proved',
      shortfall: 'none',
      claims: [
        {
          claim: 'Father',
          proof_tier: 'proved',
          shortfall: 'none',
          relationship: { type: 'ParentChild', parent: 'I2', child: 'I1' }
        }
      ]
    } as unknown as ProofSummary
    mockResearch({ proof_summaries: [conclusive] })
    render(<ProofSummariesSection />)
    await expandFirstCard()
    expect(screen.getAllByText('well established')).toHaveLength(2)
    expect(screen.queryByText('none')).toBeNull()
  })

  it('renders fact, identity and finding claims', async () => {
    const summary = {
      ...patrickFlynnResearch.proof_summaries[0],
      tier: 'possible',
      shortfall: 'gap',
      claims: [
        { claim: 'birth', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], fact: { subject: 'I1', fact_type: 'Birth', date: '1850', place: 'Ireland' } },
        { claim: 'marriage date', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], fact: { subject: { person1: 'I2', person2: 'I3' }, fact_type: 'Marriage', date: '1845' } },
        { claim: 'census', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], identity: { record_id: 'rec1', party: 'p_1', person: 'I1' } },
        { claim: 'one man', proof_tier: 'possible', shortfall: 'gap', polarity: 'denied', supporting_assertion_ids: [], identity: { person: 'I2', same_as: 'I4' } },
        { claim: 'no baptism', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], finding: { finding_type: 'absence', statement: 'No baptism found.' } },
        { claim: 'marriage', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], relationship: { type: 'Couple', person1: 'I2', person2: 'I3' } },
        { claim: 'step-father', proof_tier: 'possible', shortfall: 'gap', supporting_assertion_ids: [], relationship: { type: 'ParentChild', parent: 'I5', child: 'I1', subtype: 'Step' } },
      ]
    } as unknown as ProofSummary
    mockResearch({ proof_summaries: [summary] })
    render(<ProofSummariesSection />)
    await expandFirstCard()
    expect(screen.getByText('Birth of I1: 1850, Ireland')).toBeInTheDocument()
    expect(screen.getByText('Marriage of I2 & I3: 1845')).toBeInTheDocument()
    expect(screen.getByText('rec1 p_1 is I1')).toBeInTheDocument()
    expect(screen.getByText('I2 is I4')).toBeInTheDocument()
    expect(screen.getByText('denied')).toBeInTheDocument()
    expect(screen.getByText('absence: No baptism found.')).toBeInTheDocument()
    expect(screen.getByText('Couple: I2 & I3')).toBeInTheDocument()
    expect(screen.getByText('ParentChild (Step): I5 → I1')).toBeInTheDocument()
  })

  it('renders a proof summary missing shortfall without crashing', () => {
    const oldShapeSummary = {
      id: 'ps_001',
      question_id: 'q_002',
      tier: 'probable',
      vehicle: 'argument',
      supporting_assertion_ids: ['a_004', 'a_010', 'a_013'],
      resolved_conflict_ids: ['c_001'],
      exhaustive_search_summary: 'Searched 1850 census.',
      narrative_markdown: '## Parentage conclusion\n\nProbably the son of Thomas Flynn.'
    } as unknown as ProofSummary

    mockResearch({ proof_summaries: [oldShapeSummary] })
    expect(() => render(<ProofSummariesSection />)).not.toThrow()
    // The summary text is visible on the collapsed card; narrative is inside the body
    expect(screen.getByText('Searched 1850 census.')).toBeInTheDocument()
  })

  it('shows the empty state when there are no proof summaries', () => {
    mockResearch({ proof_summaries: [] })
    render(<ProofSummariesSection />)
    expect(screen.getByText(/No findings yet\./)).toBeInTheDocument()
  })
})
