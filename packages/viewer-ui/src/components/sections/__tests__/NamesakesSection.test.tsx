import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import NamesakesSection from '../NamesakesSection'
import type { ResearchData, Namesake } from '../../../lib/schema'
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
import { expandFirstCard } from './expandCard'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'namesakes'
    })
  )
}

function makeNamesake(overrides: Partial<Namesake> = {}): Namesake {
  return {
    id: 'ns_001',
    person_id: 'I1',
    name: 'Patrick Flynn',
    place: 'Schuylkill County, Pennsylvania, United States',
    time_period: 'died 1882',
    record_ids: ['ark:/61903/1:1:L4XK-2PQ'],
    log_entry_ids: ['log_001'],
    notes: 'Estate settled 1882; the subject died in 1908.',
    created: '2026-10-25',
    ...overrides
  }
}

describe('NamesakesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty state when namesakes is absent', () => {
    mockResearch({ namesakes: undefined })
    render(<NamesakesSection />)
    expect(screen.getByText('Namesakes')).toBeInTheDocument()
    expect(screen.getByText(/No namesakes recorded/)).toBeInTheDocument()
  })

  it('renders each row with its name, place and period', () => {
    mockResearch({ namesakes: [makeNamesake()] })
    render(<NamesakesSection />)
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.getByText('Schuylkill County, Pennsylvania, United States, died 1882')).toBeInTheDocument()
    expect(screen.queryByText(/No namesakes recorded/)).not.toBeInTheDocument()
  })

  it('labels a ruled-out row as not the same person, with its records', async () => {
    mockResearch({ namesakes: [makeNamesake()] })
    render(<NamesakesSection />)
    await expandFirstCard()
    expect(screen.getByText('Not the same person as:')).toBeInTheDocument()
    expect(screen.getByText('Records')).toBeInTheDocument()
    expect(screen.queryByText('Same name, not yet told apart from:')).not.toBeInTheDocument()
  })

  it('labels a pool row as not yet told apart, and lists no records', async () => {
    mockResearch({
      namesakes: [
        makeNamesake({
          record_ids: [],
          notes: 'pool: 4G7B-5YMM (father Willem Schultsz) and 4G7B-5YNQ (father Willem Jans); neither ruled out.'
        })
      ]
    })
    render(<NamesakesSection />)
    await expandFirstCard()
    expect(screen.getByText('Same name, not yet told apart from:')).toBeInTheDocument()
    expect(screen.queryByText('Not the same person as:')).not.toBeInTheDocument()
    expect(screen.queryByText('Records')).not.toBeInTheDocument()
  })
})
