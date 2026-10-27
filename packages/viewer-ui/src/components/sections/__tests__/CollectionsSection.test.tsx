import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CollectionsSection from '../CollectionsSection'
import { parseExternalCollections } from '../../../lib/externalCollections'
import { setOpenExternal } from '../../../lib/external'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

const doc = parseExternalCollections({
  places: {
    'Schuylkill, Pennsylvania, United States': {
      rows: [
        {
          key: 'ancestry:7163',
          url: 'https://www.ancestry.com/search/collections/7163/',
          link_text: '1870 United States Federal Census',
          record_types: ['Census'],
          place: 'Schuylkill, Pennsylvania, United States',
          cost: 'Subscription',
          content_type: 'Index',
          start_year: '1870',
          end_year: '1870'
        },
        {
          key: 'plain',
          url: 'http://example.org/census',
          link_text: 'Plain http census',
          record_types: ['Census'],
          place: 'Schuylkill, Pennsylvania, United States',
          cost: '',
          content_type: '',
          start_year: '',
          end_year: ''
        },
        {
          key: 'bad',
          url: 'javascript:alert(1)',
          link_text: 'Not a real link',
          record_types: ['Probate'],
          place: 'Schuylkill, Pennsylvania, United States',
          cost: '',
          content_type: '',
          start_year: '1800',
          end_year: '1900'
        }
      ]
    },
    'Venango, Pennsylvania, United States': { rows: [] }
  }
})

function mockCollections(collections: ReturnType<typeof parseExternalCollections>): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({ collections, activeSection: 'external_collections' })
  )
}

async function expand(place: string): Promise<void> {
  await userEvent.click(screen.getByText(place))
}

describe('CollectionsSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the empty state when no list was fetched', () => {
    mockCollections(null)
    render(<CollectionsSection />)
    expect(screen.getByText(/No collection lists fetched yet/)).toBeInTheDocument()
  })

  it('shows one card per place, with a fetched-but-empty place labelled', () => {
    mockCollections(doc)
    render(<CollectionsSection />)
    expect(screen.getByText('Schuylkill, Pennsylvania, United States')).toBeInTheDocument()
    expect(screen.getByText('3 collections · 2 record types')).toBeInTheDocument()
    expect(screen.getByText('Fetched — nothing specific to this place')).toBeInTheDocument()
  })

  it('groups rows under their record type, with years, cost and content type', async () => {
    mockCollections(doc)
    render(<CollectionsSection />)
    await expand('Schuylkill, Pennsylvania, United States')
    expect(screen.getByText('Census')).toBeInTheDocument()
    expect(screen.getByText('Probate')).toBeInTheDocument()
    expect(screen.getByText('1870 United States Federal Census')).toBeInTheDocument()
    expect(screen.getByText('1870 · Subscription · Index')).toBeInTheDocument()
    expect(screen.getByText('1800–1900')).toBeInTheDocument()
  })

  it('opens an http(s) url through openExternal', async () => {
    const open = vi.fn()
    setOpenExternal(open)
    mockCollections(doc)
    render(<CollectionsSection />)
    await expand('Schuylkill, Pennsylvania, United States')
    await userEvent.click(
      screen.getByRole('button', { name: 'https://www.ancestry.com/search/collections/7163/' })
    )
    expect(open).toHaveBeenCalledWith('https://www.ancestry.com/search/collections/7163/')
  })

  it('shows an http url as text: Electron opens only https', async () => {
    mockCollections(doc)
    render(<CollectionsSection />)
    await expand('Schuylkill, Pennsylvania, United States')
    expect(screen.getByText('http://example.org/census').tagName).toBe('CODE')
  })

  it('shows a non-http url as text, never as a button', async () => {
    mockCollections(doc)
    render(<CollectionsSection />)
    await expand('Schuylkill, Pennsylvania, United States')
    expect(screen.getByText('javascript:alert(1)').tagName).toBe('CODE')
    expect(screen.queryByRole('button', { name: 'javascript:alert(1)' })).toBeNull()
  })
})
