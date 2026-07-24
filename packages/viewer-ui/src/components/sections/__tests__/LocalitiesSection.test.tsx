import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LocalitiesSection from '../LocalitiesSection'
import type { ResearchData, Locality } from '../../../lib/schema'
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
      activeSection: 'localities'
    })
  )
}

function makeLocality(overrides: Partial<Locality> = {}): Locality {
  return {
    id: 'loc_001',
    place: 'Pennsylvania, United States',
    for_place: 'Schuylkill County, Pennsylvania',
    time_period: '1840-1880',
    jurisdictions: [{ name: 'Schuylkill County', date_range: '1811-present' }],
    collections: [{ id: 'c1', title: 'Pennsylvania Probate Records', date_range: '1810-1920' }],
    quirks: ['Parish records indexed only at the county level.'],
    guide_markdown: 'Full locality guide text.',
    pages_read: [
      { section: 'home', url: 'u', found: true },
      { section: 'getting_started', url: 'u', found: true },
      { section: 'online_records', url: 'u', found: true },
      { section: 'research_tips', url: null, found: false }
    ],
    source: 'locality-guide',
    created: '2026-07-15',
    ...overrides
  }
}

describe('LocalitiesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the empty state when localities is absent', () => {
    mockResearch({ localities: undefined })
    render(<LocalitiesSection />)
    expect(screen.getByText('Localities')).toBeInTheDocument()
    expect(screen.getByText(/No locality guides saved yet/)).toBeInTheDocument()
  })

  it('renders the empty state when localities is empty', () => {
    mockResearch({ localities: [] })
    render(<LocalitiesSection />)
    expect(screen.getByText(/No locality guides saved yet/)).toBeInTheDocument()
  })

  it('renders a locality with its place and subtitle (always visible)', () => {
    mockResearch({ localities: [makeLocality()] })
    render(<LocalitiesSection />)
    expect(screen.getByText(/Pennsylvania, United States/)).toBeInTheDocument()
    expect(screen.getByText(/Schuylkill County, Pennsylvania · 1840-1880/)).toBeInTheDocument()
  })

  it('reveals jurisdictions, collections, and quirks when the card is expanded', async () => {
    mockResearch({ localities: [makeLocality()] })
    render(<LocalitiesSection />)
    await userEvent.click(screen.getByText(/Pennsylvania, United States/))
    expect(screen.getByText('Pennsylvania Probate Records')).toBeInTheDocument()
    expect(screen.getByText('Parish records indexed only at the county level.')).toBeInTheDocument()
  })

  it('marks a 404 section found:false and an omitted section as not attempted', () => {
    mockResearch({
      localities: [
        makeLocality({
          pages_read: [
            { section: 'home', url: 'u', found: true }
            // getting_started, online_records, research_tips all omitted
          ]
        })
      ]
    })
    render(<LocalitiesSection />)
    // home was read
    expect(screen.getByTitle('Overview: read')).toBeInTheDocument()
    // the three omitted sections render as "not attempted"
    expect(screen.getByTitle('Getting Started: not attempted')).toBeInTheDocument()
    expect(screen.getByTitle('Online Records: not attempted')).toBeInTheDocument()
    expect(screen.getByTitle('Research Tips: not attempted')).toBeInTheDocument()
  })

  it('marks a section present-but-not-found as a 404', () => {
    mockResearch({ localities: [makeLocality()] })
    render(<LocalitiesSection />)
    expect(screen.getByTitle(/Research Tips: no page for this place/)).toBeInTheDocument()
  })
})
