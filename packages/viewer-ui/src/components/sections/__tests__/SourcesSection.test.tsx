import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SourcesSection from '../SourcesSection'
import type { ResearchData, Source } from '../../../lib/schema'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../../lib/__fixtures__/patrick-flynn'
import { setOpenExternal } from '../../../lib/external'

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

describe('SourcesSection — url_archived (#1166)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
  })

  const ARCHIVED = 'https://web.archive.org/web/20260101/https://example.com/record/1'

  it('renders the Archived URL when present', async () => {
    mockResearch({ sources: [makeSource({ url_archived: ARCHIVED })] })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.getByText('Archived URL')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ARCHIVED })).toBeInTheDocument()
  })

  it('omits the Archived URL when url_archived is null', async () => {
    mockResearch({ sources: [makeSource({ url_archived: null })] })
    render(<SourcesSection />)
    await expandFirstCard()
    expect(screen.queryByText('Archived URL')).toBeNull()
  })

  it('clicking the Archived URL routes through openExternal', async () => {
    const opened = vi.fn()
    setOpenExternal(opened)
    mockResearch({ sources: [makeSource({ url_archived: ARCHIVED })] })
    render(<SourcesSection />)
    await expandFirstCard()
    await userEvent.click(screen.getByRole('button', { name: ARCHIVED }))
    expect(opened).toHaveBeenCalledWith(ARCHIVED)
  })
})

describe('SourcesSection — tree-only sources (#2661)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
  })

  it('renders tree sources under "From the imported tree" when no research source covers them', () => {
    // One research source covers S1; S2, S3, S4 are tree-only.
    mockResearch({
      sources: [makeSource({ gedcomx_source_description_id: 'S1' })]
    })
    render(<SourcesSection />)
    expect(screen.getByText('From the imported tree')).toBeInTheDocument()
    expect(screen.getByText('1860 U.S. Federal Census')).toBeInTheDocument()
    expect(screen.getByText('Pennsylvania Death Certificates')).toBeInTheDocument()
    expect(screen.getByText('Schuylkill County Probate Records')).toBeInTheDocument()
  })

  it('does not show tree subheading when all tree sources are covered', () => {
    mockResearch({
      sources: [
        makeSource({ id: 'src_01', gedcomx_source_description_id: 'S1' }),
        makeSource({ id: 'src_02', gedcomx_source_description_id: 'S2' }),
        makeSource({ id: 'src_03', gedcomx_source_description_id: 'S3' }),
        makeSource({ id: 'src_04', gedcomx_source_description_id: 'S4' })
      ]
    })
    render(<SourcesSection />)
    expect(screen.queryByText('From the imported tree')).toBeNull()
  })

  it('shows empty state when both research and gedcomx sources are absent', () => {
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({
        research: { ...patrickFlynnResearch, sources: [] },
        gedcomx: null,
        activeSection: 'sources'
      })
    )
    render(<SourcesSection />)
    expect(screen.getByText(/No sources captured yet/)).toBeInTheDocument()
    expect(screen.queryByText('From the imported tree')).toBeNull()
  })

  it('tree source card has id for CrossLink scrolling', () => {
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({
        research: { ...patrickFlynnResearch, sources: [] },
        gedcomx: {
          ...patrickFlynnGedcomx,
          sources: [{ id: 'S99', title: 'A Test Source' }]
        },
        activeSection: 'sources'
      })
    )
    render(<SourcesSection />)
    expect(document.getElementById('S99')).toBeTruthy()
  })

  it('tree source URL routes through openExternal', async () => {
    const opened = vi.fn()
    setOpenExternal(opened)
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({
        research: { ...patrickFlynnResearch, sources: [] },
        gedcomx: {
          ...patrickFlynnGedcomx,
          sources: [{ id: 'S99', title: 'A Source', url: 'https://example.com/record' }]
        },
        activeSection: 'sources'
      })
    )
    render(<SourcesSection />)
    await expandFirstCard()
    await userEvent.click(screen.getByRole('button', { name: 'https://example.com/record' }))
    expect(opened).toHaveBeenCalledWith('https://example.com/record')
  })
})
