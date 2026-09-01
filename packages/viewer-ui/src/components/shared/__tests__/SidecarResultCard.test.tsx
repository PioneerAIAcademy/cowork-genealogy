import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidecarResultCard from '../SidecarResultCard'
import { patrickFlynnSidecar } from '../../../lib/__fixtures__/patrick-flynn-sidecar'
import { setOpenExternal } from '../../../lib/external'
import type { RecordSearchResult, FulltextSearchResult } from '../../../lib/schema'

describe('SidecarResultCard — record_search', () => {
  const result = patrickFlynnSidecar.payload.results![0] as RecordSearchResult

  beforeEach(() => vi.clearAllMocks())

  it('renders the recordTitle and score in the header', () => {
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={false} />)
    expect(screen.getByText('New York State Census, 1865')).toBeInTheDocument()
    expect(screen.getByText('score 0.94')).toBeInTheDocument()
  })

  it('hides the persons subview when collapsed', () => {
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={false} />)
    expect(screen.queryByText('Persons')).toBeNull()
    expect(screen.queryByText('Patrick Flynn')).toBeNull()
  })

  it('shows persons in PRIMARY → spouse → parent order when expanded', () => {
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    // All four persons rendered
    const persons = ['Patrick Flynn', 'Mary Flynn', 'Thomas Flynn', 'Bridget Flynn']
    for (const name of persons) expect(screen.getByText(name)).toBeInTheDocument()
    // Order check: Patrick (PRIMARY) before Mary (WIFE) before Thomas (FATHER)
    const html = document.body.innerHTML
    const positions = persons.map((p) => html.indexOf(p))
    expect(positions[0]).toBeLessThan(positions[1]) // Patrick before Mary
    expect(positions[1]).toBeLessThan(positions[2]) // Mary before Thomas
  })

  it('clicking the header toggles expansion', async () => {
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={false} />)
    // Click via the role="button" header
    const header = screen.getAllByRole('button').find((b) => b.tagName.toLowerCase() === 'header')
    expect(header).toBeDefined()
    await userEvent.click(header!)
    expect(screen.getByText('Persons')).toBeInTheDocument()
  })

  it('renders the Tree matches block when treeMatches is non-empty', () => {
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    expect(screen.getByText('Tree matches')).toBeInTheDocument()
  })

  it('omits the Tree matches block when treeMatches is empty', () => {
    render(
      <SidecarResultCard
        result={{ ...result, treeMatches: [] }}
        tool="record_search"
        defaultExpanded={true}
      />
    )
    expect(screen.queryByText('Tree matches')).toBeNull()
  })
})

describe('SidecarResultCard — fulltext_search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
  })

  // Production-shaped: mapEntry emits a bare ARK `id` plus a separate
  // `sourceUrl`, and a `title` when the upstream record has one (#1996) —
  // the old fixture gave `id` a full URL and no `title`, a shape the tool
  // never actually emits, which is why the title/link bugs passed CI.
  const fulltextResult: FulltextSearchResult = {
    id: 'ark:/61903/3:1:S3HT-XYZ',
    sourceUrl: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ',
    collectionTitle: 'Pennsylvania Probate Records',
    title: 'Last Will and Testament of Thomas Flynn',
    recordDate: '1849',
    recordType: 'Will',
    recordPlace: 'Schuylkill County, PA',
    textDocument: 'Last Will of Thomas Flynn, naming sons Patrick and James as heirs.',
    names: ['Thomas Flynn', 'Patrick Flynn', 'James Flynn'],
    places: ['Schuylkill County, PA'],
    // Deliberately distinct from recordDate (probate filed 1849, referencing
    // an earlier 1846 death date in the body) so a test can tell "merged"
    // apart from "recordDate silently hid dates' other entries".
    dates: ['1849', '1846'],
    highlightTerms: ['Thomas', 'Patrick']
  }

  it('renders the text snippet with highlight markers around matched terms', () => {
    render(
      <SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={true} />
    )
    // `Thomas` and `Patrick` should each be wrapped in a <mark>
    const marks = document.querySelectorAll('mark')
    const markText = Array.from(marks).map((m) => m.textContent)
    expect(markText).toContain('Thomas')
    expect(markText).toContain('Patrick')
  })

  it('renders names and places lists', () => {
    render(
      <SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={true} />
    )
    expect(screen.getByText('Thomas Flynn, Patrick Flynn, James Flynn')).toBeInTheDocument()
    expect(screen.getByText('Schuylkill County, PA')).toBeInTheDocument()
  })

  it('titles the card from `title`, not `recordType`', () => {
    render(<SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={false} />)
    expect(
      screen.getByRole('heading', { name: 'Last Will and Testament of Thomas Flynn' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Will' })).toBeNull()
  })

  it('falls back to recordType then collectionTitle when title is absent', () => {
    const { title: _title, ...noTitle } = fulltextResult
    render(<SidecarResultCard result={noTitle} tool="fulltext_search" defaultExpanded={false} />)
    expect(screen.getByRole('heading', { name: 'Will' })).toBeInTheDocument()
  })

  it('opens sourceUrl (not the bare ARK id) when the footer link is clicked', async () => {
    const spy = vi.fn()
    setOpenExternal(spy)
    render(
      <SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={true} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ')
  })

  it('derives the FamilySearch URL from the bare ARK id when sourceUrl is absent', async () => {
    const { sourceUrl: _sourceUrl, ...noSourceUrl } = fulltextResult
    const spy = vi.fn()
    setOpenExternal(spy)
    render(
      <SidecarResultCard result={noSourceUrl} tool="fulltext_search" defaultExpanded={true} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ')
  })

  it('derives the FamilySearch URL from the bare ARK id when sourceUrl is an empty string', async () => {
    // A producer setting sourceUrl to "" (not absent) must not be treated as
    // "present" -- `??` alone would substitute nothing and openExternal
    // would then silently no-op on the empty string.
    const spy = vi.fn()
    setOpenExternal(spy)
    render(
      <SidecarResultCard
        result={{ ...fulltextResult, sourceUrl: '' }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ')
  })

  it('falls back past an empty-string title to recordType', () => {
    render(
      <SidecarResultCard
        result={{ ...fulltextResult, title: '' }}
        tool="fulltext_search"
        defaultExpanded={false}
      />
    )
    expect(screen.getByRole('heading', { name: 'Will' })).toBeInTheDocument()
  })

  it('merges recordDate with dates rather than letting recordDate hide the rest', () => {
    render(
      <SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={true} />
    )
    // recordDate is '1849' and dates adds a distinct '1846' -- both must render.
    expect(screen.getByText('1849, 1846')).toBeInTheDocument()
  })

  it('deduplicates when recordDate also appears in dates', () => {
    render(
      <SidecarResultCard
        result={{ ...fulltextResult, dates: ['1849'] }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    expect(screen.getByText('1849')).toBeInTheDocument()
  })
})
