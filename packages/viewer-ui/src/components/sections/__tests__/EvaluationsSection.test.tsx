import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EvaluationsSection from '../EvaluationsSection'
import type { EvaluationEntry, ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../../lib/__fixtures__/patrick-flynn'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return {
    ...actual,
    useResearchData: vi.fn()
  }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import { expandFirstCard } from './expandCard'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      gedcomx: patrickFlynnGedcomx,
      activeSection: 'evaluations'
    })
  )
}

const proofCritique: EvaluationEntry = {
  id: 'ev_001',
  focus: 'proof-critique',
  target_id: 'ps_001',
  target_type: 'proof_summary',
  verdict: 'address_first',
  file_path: '/host/only/ev_001.md',
  timestamp: '2026-08-03T10:00:00Z',
  superseded_by: null
}

// Card defaults to collapsed: badges render in the header, everything else
// needs an expand. StatusBadge also humanizes `_` to a space.

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EvaluationsSection', () => {
  it('renders the verdict — the reason this section exists (#1223)', () => {
    // The mentor gate is mandatory to invoke and record, and an `address_first`
    // verdict is the mentor saying a proof needs work before it stands. It was
    // recorded and invisible until this section existed.
    mockResearch({ evaluations: [proofCritique] })
    render(<EvaluationsSection />)
    expect(screen.getByText('address first')).toBeInTheDocument()
  })

  it('says what was reviewed, and links it', async () => {
    mockResearch({ evaluations: [proofCritique] })
    render(<EvaluationsSection />)
    await expandFirstCard()
    expect(screen.getByText(/proof summary/i)).toBeInTheDocument()
    expect(screen.getByText('ps_001')).toBeInTheDocument()
  })

  it('names the checkpoint in words rather than the raw enum', () => {
    mockResearch({ evaluations: [proofCritique] })
    render(<EvaluationsSection />)
    expect(screen.getByText('Proof critique')).toBeInTheDocument()
  })

  it('does not try to cross-link a project-level evaluation', async () => {
    // `target_type: "project"` has no card to point at — the whole project is
    // the subject — so the target renders as plain text, not a dead link.
    mockResearch({
      evaluations: [
        { ...proofCritique, id: 'ev_002', target_type: 'project', target_id: 'proj' }
      ]
    })
    render(<EvaluationsSection />)
    await expandFirstCard()
    expect(screen.getByText(/^project$/i)).toBeInTheDocument()
    expect(screen.queryByText('proj')).not.toBeInTheDocument()
  })

  it('marks a superseded evaluation so a stale verdict is not read as current', async () => {
    mockResearch({
      evaluations: [{ ...proofCritique, superseded_by: 'ev_009' }]
    })
    render(<EvaluationsSection />)
    expect(screen.getByText(/superseded/i)).toBeInTheDocument()  // header badge
    await expandFirstCard()
    expect(screen.getByText('ev_009')).toBeInTheDocument()
  })

  it('never renders file_path — it is a host-side path the reader cannot open', async () => {
    // Must expand first: a collapsed card renders no body, so asserting on the
    // collapsed DOM would pass no matter what the body contained.
    mockResearch({ evaluations: [proofCritique] })
    const { container } = render(<EvaluationsSection />)
    await expandFirstCard()
    expect(container.textContent).toContain('proof summary')  // body really is open
    expect(container.textContent).not.toContain('/host/only/ev_001.md')
  })

  it('shows an empty state rather than nothing when no mentor has run', () => {
    mockResearch({ evaluations: [] })
    render(<EvaluationsSection />)
    expect(screen.getByText(/no mentor evaluations recorded/i)).toBeInTheDocument()
  })
})
