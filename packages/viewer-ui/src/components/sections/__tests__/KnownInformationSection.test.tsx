import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KnownInformationSection from '../KnownInformationSection'
import type { ResearchData, KnownHolding } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'

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

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'known_holdings'
    })
  )
}

function makeHolding(overrides: Partial<KnownHolding> = {}): KnownHolding {
  return {
    id: 'kh_001',
    holding_type: 'document',
    description: "Patrick Flynn's death certificate",
    relevant_facts: null,
    relates_to_person_ids: [],
    confidence: 'confident',
    promoted: false,
    created: '2026-06-14',
    ...overrides
  }
}

describe('KnownInformationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty state when there are no holdings', () => {
    mockResearch({ known_holdings: [] })
    render(<KnownInformationSection />)
    expect(screen.getByText('Known Information')).toBeInTheDocument()
    expect(screen.getByText(/No known information recorded/)).toBeInTheDocument()
  })

  it('renders the empty state when known_holdings is absent', () => {
    mockResearch({ known_holdings: undefined })
    render(<KnownInformationSection />)
    expect(screen.getByText(/No known information recorded/)).toBeInTheDocument()
  })

  it('renders a holding with a humanized type label and confidence badge', () => {
    mockResearch({
      known_holdings: [
        makeHolding({ holding_type: 'oral_knowledge', confidence: 'unsure' })
      ]
    })
    render(<KnownInformationSection />)
    expect(screen.getByText("Patrick Flynn's death certificate")).toBeInTheDocument()
    expect(screen.getByText('Family Knowledge')).toBeInTheDocument()
    expect(screen.getByText('unsure')).toBeInTheDocument()
    expect(screen.getByText('Not yet examined')).toBeInTheDocument()
  })

  it('shows a promoted badge once the holding has been examined', () => {
    mockResearch({ known_holdings: [makeHolding({ promoted: true })] })
    render(<KnownInformationSection />)
    expect(screen.getByText('promoted')).toBeInTheDocument()
    expect(screen.getByText('Promoted to a source')).toBeInTheDocument()
  })

  it('reveals relevant_facts when the card is expanded', async () => {
    mockResearch({
      known_holdings: [makeHolding({ relevant_facts: 'Names both of his parents.' })]
    })
    render(<KnownInformationSection />)
    await userEvent.click(screen.getByText("Patrick Flynn's death certificate"))
    expect(screen.getByText('Facts it may supply')).toBeInTheDocument()
    expect(screen.getByText('Names both of his parents.')).toBeInTheDocument()
  })
})
