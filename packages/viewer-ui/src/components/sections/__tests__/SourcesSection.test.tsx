import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SourcesSection from '../SourcesSection'
import type { ResearchData, Source } from '../../../lib/schema'
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
      activeSection: 'sources'
    })
  )
}

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src_xx',
    gedcomx_source_description_id: 'S99',
    citation: 'Test citation.',
    citation_detail: {
      who: 'Tester',
      what: 'Test record',
      when_created: '2020',
      when_accessed: '2026',
      where: 'Test repo',
      where_within: 'Test page'
    },
    source_classification: 'original',
    repository: 'Test',
    access_date: '2026-01-01',
    url: null,
    url_archived: null,
    notes: null,
    ...overrides
  }
}

// Cards are collapsed by default; click the header (parent of the title)
// to expand the body and footer.
async function expandFirstCard(): Promise<void> {
  // Pick the first card's chevron span and click its parent (header).
  const chevrons = screen.getAllByText(/^[▾▸]$/)
  if (chevrons.length === 0) throw new Error('No card chevrons found')
  const header = chevrons[0].closest('div')?.parentElement
  if (!header) throw new Error('No header element found')
  await userEvent.click(header)
}

describe('SourcesSection — B2 transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the transcription block when card is expanded and value is present', async () => {
    // Single source with a transcription, so the first card is the right one.
    mockResearch({
      sources: [
        makeSource({
          id: 'src_with',
          transcription: 'Patrick Flynn  5  M  Pennsylvania\nMary Flynn     3  F  Pennsylvania'
        })
      ]
    })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.getByText('Transcription')).toBeInTheDocument()
    expect(screen.getByText(/Patrick Flynn\s+5/)).toBeInTheDocument()
  })

  it('omits the transcription label when transcription is absent', async () => {
    mockResearch({ sources: [makeSource({ id: 'src_only' })] })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.queryByText('Transcription')).toBeNull()
  })

  it('shows Show more / Show less toggle when transcription exceeds 300 chars', async () => {
    const longText = 'a'.repeat(500)
    mockResearch({ sources: [makeSource({ transcription: longText })] })
    render(<SourcesSection />)
    await expandFirstCard()
    const showMore = screen.getByRole('button', { name: 'Show more' })
    expect(showMore).toBeInTheDocument()
    await userEvent.click(showMore)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
  })

  it('does not show toggle when transcription is short (<= 300 chars)', async () => {
    const shortText = 'a'.repeat(100)
    mockResearch({ sources: [makeSource({ transcription: shortText })] })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.queryByRole('button', { name: /Show more|Show less/ })).toBeNull()
  })
})

describe('SourcesSection — B3 captured-by footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the Captured by CrossLink when log_entry_id is present', async () => {
    mockResearch({
      sources: [makeSource({ id: 'src_xx', log_entry_id: 'log_077' })]
    })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.getByText('Captured by: log_077')).toBeInTheDocument()
  })

  it('omits the Captured by link when log_entry_id is null', async () => {
    mockResearch({
      sources: [makeSource({ id: 'src_orphan', log_entry_id: null })]
    })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.queryByText(/Captured by/)).toBeNull()
  })
})
