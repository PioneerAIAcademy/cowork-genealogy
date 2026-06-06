import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidecarResultCard from '../SidecarResultCard'
import { patrickFlynnSidecar } from '../../../lib/__fixtures__/patrick-flynn-sidecar'
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
  beforeEach(() => vi.clearAllMocks())

  const fulltextResult: FulltextSearchResult = {
    id: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ',
    collectionTitle: 'Pennsylvania Probate Records',
    recordType: 'Will',
    recordPlace: 'Schuylkill County, PA',
    textDocument: 'Last Will of Thomas Flynn, naming sons Patrick and James as heirs.',
    names: ['Thomas Flynn', 'Patrick Flynn', 'James Flynn'],
    places: ['Schuylkill County, PA'],
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
})
