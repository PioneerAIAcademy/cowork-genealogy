import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RejectedLinksSection from '../RejectedLinksSection'
import type { ResearchData, RejectedLink } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import { expandCardByTitle } from './expandCard'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'rejected_links'
    })
  )
}

const WORDS = "No, that's a different Patrick. Wrong parish."
const LEGACY_REASON = 'Different parish and a ten-year age gap.'

const withWords: RejectedLink = {
  id: 'rj_001',
  assertion_id: 'a_001',
  person_id: 'I1',
  reason: null,
  researcher_words: WORDS,
  created: '2026-10-21'
}

// Written before researcher_words existed: the field is absent, not empty.
const legacy: RejectedLink = {
  id: 'rj_002',
  assertion_id: 'a_004',
  person_id: 'I2',
  reason: LEGACY_REASON,
  created: '2026-10-01'
}

describe('RejectedLinksSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the empty state when rejected_links is absent', () => {
    mockResearch({ rejected_links: undefined })
    render(<RejectedLinksSection />)
    expect(screen.getByText('Rejected Links')).toBeInTheDocument()
    expect(screen.getByText(/No rejected links/)).toBeInTheDocument()
  })

  it("shows the researcher's words, and the legacy notice, without expanding a card", () => {
    mockResearch({ rejected_links: [withWords, legacy] })
    render(<RejectedLinksSection />)
    expect(screen.getByText(WORDS)).toBeInTheDocument()
    expect(screen.getByText(WORDS).tagName).toBe('Q')
    expect(
      screen.getByText("Researcher's words not recorded (row predates the field)")
    ).toBeInTheDocument()
    // No fallback to `reason` where the words belong.
    expect(screen.queryByText(LEGACY_REASON)).not.toBeInTheDocument()
  })

  it('renders the body fields when expanded, and never the text "null" for a null reason', async () => {
    mockResearch({ rejected_links: [withWords, legacy] })
    render(<RejectedLinksSection />)
    await expandCardByTitle('rj_001')
    expect(screen.getByText('2026-10-21', { exact: false })).toBeInTheDocument()
    expect(screen.getByTitle('Go to a_001')).toHaveTextContent('Assertion')
    expect(screen.getByTitle('Go to I1')).toHaveTextContent('Person')
    expect(screen.queryByText(/\bnull\b/)).not.toBeInTheDocument()
    expect(screen.queryByText('Reason:')).not.toBeInTheDocument()
  })

  it('renders the reason once a legacy card is expanded', async () => {
    mockResearch({ rejected_links: [withWords, legacy] })
    render(<RejectedLinksSection />)
    await expandCardByTitle('rj_002')
    expect(screen.getByText(LEGACY_REASON)).toBeInTheDocument()
  })
})
