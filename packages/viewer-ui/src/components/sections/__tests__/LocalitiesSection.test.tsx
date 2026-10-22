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
    expect(screen.getByText(/locality-guide step/)).toBeInTheDocument()
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

  it('shows registration starts, volume counts and collection counts when the card is expanded', async () => {
    mockResearch({
      localities: [
        makeLocality({
          collections: [{ id: 'c1', title: 'PA Deaths', date_range: '1906-1968', person_count: 6542331, record_count: null }],
          registration_start: [
            { event: 'birth', level: 'state', year: 1906, source_url: 'https://wiki/Pennsylvania_Vital_Records' }
          ],
          volume_summary: {
            start_year: 1840,
            end_year: 1880,
            total_volumes: 31,
            complete: false,
            by_record_type: [{ group: 'Probate', volumes: 12, browse_only: 9, fulltext_only: null }],
            untyped: { volumes: 2, browse_only: 2, fulltext_only: 0 }
          }
        })
      ]
    })
    render(<LocalitiesSection />)
    await userEvent.click(screen.getByText(/Pennsylvania, United States/))
    expect(screen.getByText(/6,542,331 people/)).toBeInTheDocument()
    expect(screen.queryByText(/records$/)).not.toBeInTheDocument()
    expect(screen.getByText('birth: 1906')).toBeInTheDocument()
    expect(screen.getByText('state level')).toBeInTheDocument()
    expect(screen.getByText(/Digitized volumes \(1840–1880\): 31 — partial count/)).toBeInTheDocument()
    expect(screen.getByText('Probate: 12')).toBeInTheDocument()
    expect(screen.getByText('9 browse-only · unknown full-text only')).toBeInTheDocument()
    expect(screen.getByText('No record type: 2')).toBeInTheDocument()
  })

  it('marks a found:false section with outcome unreachable as an outage, not a 404', () => {
    mockResearch({
      localities: [
        makeLocality({
          pages_read: [
            { section: 'home', url: null, found: false, outcome: 'unreachable' },
            { section: 'getting_started', url: null, found: false }
          ]
        })
      ]
    })
    render(<LocalitiesSection />)
    expect(screen.getByTitle(/Overview: wiki unreachable/)).toBeInTheDocument()
    expect(screen.queryByTitle(/Overview: no page for this place/)).not.toBeInTheDocument()
    expect(screen.getByTitle(/Getting Started: no page for this place/)).toBeInTheDocument()
  })
})
