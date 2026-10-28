import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidecarResultCard from '../SidecarResultCard'
import { setOpenExternal, setOpenFamilySearch } from '../../../lib/external'
import { patrickFlynnSidecar } from '../../../lib/__fixtures__/patrick-flynn-sidecar'
import { flynnRecordReadSidecar } from '../../../lib/__fixtures__/flynn-record-read-sidecar'
import type { RecordSearchResult, FulltextSearchResult } from '../../../lib/schema'
import type { RecordReadResult } from '../SidecarResultCard'

/** One builder for every "the base result, but with X" case in this file.
 *  No trailing `as RecordSearchResult`: the return annotation already types the
 *  literal, and the extra cast would swallow a genuine shape error. */
const withResult = (overrides: Partial<RecordSearchResult>): RecordSearchResult => ({
  ...(patrickFlynnSidecar.payload.results![0] as RecordSearchResult),
  ...overrides
})

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
    setOpenFamilySearch(() => {})
  })

  // Production-shaped: mapEntry emits a bare ARK `id` plus a separate
  // `sourceUrl`, and a `title` when the upstream record has one (#1996) —
  // the old fixture gave `id` a full URL and no `title`, a shape the tool
  // never emits today. Sidecars staged before #272 do carry that shape and
  // are still on disk, so it is covered separately below.
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
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard result={fulltextResult} tool="fulltext_search" defaultExpanded={true} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/3:1:S3HT-XYZ')
  })

  it('falls back to the bare ARK id when sourceUrl is absent', async () => {
    const { sourceUrl: _sourceUrl, ...noSourceUrl } = fulltextResult
    const spy = vi.fn()
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard result={noSourceUrl} tool="fulltext_search" defaultExpanded={true} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    // openFamilySearch forwards the raw identifier; resolution happens
    // downstream in the platform implementation, not in this component.
    expect(spy).toHaveBeenCalledWith('ark:/61903/3:1:S3HT-XYZ')
  })

  it('falls back to the bare ARK id when sourceUrl is an empty string', async () => {
    // A producer setting sourceUrl to "" (not absent) must not be treated as
    // "present" -- `||` alone would substitute nothing and openFamilySearch
    // would then silently no-op on the empty string.
    const spy = vi.fn()
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard
        result={{ ...fulltextResult, sourceUrl: '' }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('ark:/61903/3:1:S3HT-XYZ')
  })

  it('falls back to id when sourceUrl is present but the policy refuses it', async () => {
    // The gap the other two fallback tests don't cover: sourceUrl absent, and
    // sourceUrl === '' are both falsy, so `sourceUrl || id` and
    // `resolveFamilySearchTarget(sourceUrl) || resolveFamilySearchTarget(id)`
    // agree by construction. A TRUTHY sourceUrl the policy refuses is the case
    // where they can diverge: the gate falls through to id and renders the
    // button, but a naive `onClick={() => openFamilySearch(sourceUrl || id)}`
    // still passes the bad sourceUrl, since it is non-empty. That renders a
    // button which opens nothing.
    const spy = vi.fn()
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard
        result={{ ...fulltextResult, sourceUrl: 'https://evil.example/whatever' }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    const button = screen.getByRole('button', { name: /Open in FamilySearch/ })
    await userEvent.click(button)
    // Raw id, matching the other fallback tests: openFamilySearch forwards the
    // raw identifier and resolution happens downstream, not in this component.
    expect(spy).toHaveBeenCalledWith('ark:/61903/3:1:S3HT-XYZ')
  })

  it('falls back to id when sourceUrl is a real FamilySearch URL the policy still refuses', async () => {
    // A realistic instance of the same gap: resolveFamilySearchTarget's ARK_RE
    // is `$`-anchored, so a page-parameter suffix (a shape Linkify.test.tsx
    // already pins as occurring in project data) fails to resolve even though
    // the host is genuinely familysearch.org.
    const spy = vi.fn()
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard
        result={{
          ...fulltextResult,
          sourceUrl: 'https://www.familysearch.org/ark:/61903/3:1:S3HT-XKR9-NXF?i=353'
        }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('ark:/61903/3:1:S3HT-XYZ')
  })

  it('opens a legacy full-URL id as-is, without prefixing the host again', async () => {
    const { sourceUrl: _sourceUrl, ...legacy } = fulltextResult
    const spy = vi.fn()
    setOpenFamilySearch(spy)
    render(
      <SidecarResultCard
        result={{ ...legacy, id: 'https://familysearch.org/ark:/61903/1:1:K5M9-P3WT' }}
        tool="fulltext_search"
        defaultExpanded={true}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(spy).toHaveBeenCalledWith('https://familysearch.org/ark:/61903/1:1:K5M9-P3WT')
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

/**
 * Link visibility, sidecar side (#2049 review).
 *
 * Same regression PersonCard.test.tsx pins, in the component that did not gate.
 * PersonCard checked `resolveFamilySearchTarget` before rendering; the three
 * sidecar sinks checked only truthiness, so a value the policy refuses rendered
 * "Open in FamilySearch →" and clicking it did nothing.
 *
 * Not hypothetical: `apps/server/app/agent/mock_agent.py` writes
 * `"arkUrl": "https://www.familysearch.org/ark:/example"`, and `agent_mode`
 * defaults to `"mock"` — so the default hosted path rendered the dead button.
 * `ark:/example` carries no `\d:\d:` and the policy returns null for it.
 */
describe('SidecarResultCard — link visibility', () => {
  const withArkUrl = (arkUrl: string): RecordSearchResult => withResult({ arkUrl })

  it('renders the link for an arkUrl the policy resolves', () => {
    render(
      <SidecarResultCard
        result={withArkUrl('https://www.familysearch.org/ark:/61903/1:1:MXYZ-9QP')}
        tool="record_search"
        defaultExpanded={true}
      />
    )
    expect(screen.getByRole('button', { name: /Open in FamilySearch/ })).toBeInTheDocument()
  })

  it('renders the link from recordArk, which is what record_search really emits', () => {
    // The engine has no `arkUrl`; it emits `recordArk`. Without the fallback
    // the footer link never rendered for a real sidecar.
    const result = {
      ...(patrickFlynnSidecar.payload.results![0] as RecordSearchResult),
      arkUrl: undefined,
      recordArk: 'ark:/61903/1:1:MXYZ-9QP'
    } as RecordSearchResult
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    expect(screen.getByRole('button', { name: /Open in FamilySearch/ })).toBeInTheDocument()
  })

  it('renders NO link for an arkUrl the policy refuses', () => {
    // The mock agent's literal value.
    render(
      <SidecarResultCard
        result={withArkUrl('https://www.familysearch.org/ark:/example')}
        tool="record_search"
        defaultExpanded={true}
      />
    )
    expect(screen.queryByRole('button', { name: /Open in FamilySearch/ })).toBeNull()
  })
})

/**
 * The PER-ROW tree-match link, which the block above does NOT cover — that one
 * asserts the footer `arkUrl` link ("Open in FamilySearch"). Before these two
 * cases nothing in the repo asserted the row's "View →" button in either
 * direction, so dropping the link, or passing the bare `treePersonId` to the
 * policy (which refuses it), shipped green.
 */
describe('SidecarResultCard — tree-match link visibility', () => {
  const withTreeMatch = (treePersonId: string): RecordSearchResult =>
    withResult({ treeMatches: [{ treePersonId, stars: 5 }] })

  // `lib/external.ts` holds module-level singletons that persist across
  // describes, so without this the block inherits whichever impl the previous
  // block installed.
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
    setOpenFamilySearch(() => {})
  })

  it('renders the View link for a tree PID the policy resolves', () => {
    render(
      <SidecarResultCard
        result={withTreeMatch('KW7C-X9P')}
        tool="record_search"
        defaultExpanded={true}
      />
    )
    expect(screen.getByRole('button', { name: /View/ })).toBeInTheDocument()
  })

  it('skips a row with no treePersonId instead of rendering an empty chip', () => {
    // Sidecar payloads are untyped at runtime and reach this component through
    // a cast, so a row without a PID is reachable. Skipping it is what keeps
    // every row from sharing key={undefined} — the original #2476 symptom.
    const result = withResult({
      treeMatches: [
        { treePersonId: '', stars: 4 },
        { treePersonId: 'KW7C-X9P', stars: 5 }
      ] as RecordSearchResult['treeMatches']
    })
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('KW7C-X9P')).toBeInTheDocument()
  })

  it('omits the stars when they are not a number', () => {
    const result = withResult({
      treeMatches: [
        { treePersonId: 'KW7C-X9P', stars: undefined }
      ] as unknown as RecordSearchResult['treeMatches']
    })
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    expect(screen.getByText('KW7C-X9P')).toBeInTheDocument()
    expect(screen.queryByText('/5')).toBeNull()
  })

  it('renders NO View link for a tree PID the policy refuses', () => {
    render(
      <SidecarResultCard
        result={withTreeMatch('XX-1')}
        tool="record_search"
        defaultExpanded={true}
      />
    )
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull()
  })
})

/** The row link's channel, which the visibility block above cannot see.
 *  Same assertion as the footer link's, for the other sink in this file. */
describe('SidecarResultCard — tree-match link channel', () => {
  const fs = vi.fn()
  const generic = vi.fn()

  beforeEach(() => {
    fs.mockClear()
    generic.mockClear()
    setOpenFamilySearch(fs)
    setOpenExternal(generic)
  })

  it('routes the tree-match link through the constrained channel', async () => {
    const result = {
      ...(patrickFlynnSidecar.payload.results![0] as RecordSearchResult),
      treeMatches: [{ treePersonId: 'KW7C-X9P', stars: 5 }]
    } as RecordSearchResult
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    await userEvent.click(screen.getByRole('button', { name: /View KW7C-X9P/ }))
    expect(fs).toHaveBeenCalledTimes(1)
    expect(generic).not.toHaveBeenCalled()
  })
})

/** Same channel assertion as PersonCard's, for the other constrained component. */
describe('SidecarResultCard — link channel', () => {
  const fs = vi.fn()
  const generic = vi.fn()

  beforeEach(() => {
    fs.mockClear()
    generic.mockClear()
    setOpenFamilySearch(fs)
    setOpenExternal(generic)
  })

  it('routes the FamilySearch link through the constrained channel', async () => {
    const result = {
      ...(patrickFlynnSidecar.payload.results![0] as RecordSearchResult),
      arkUrl: 'https://www.familysearch.org/ark:/61903/1:1:MXYZ-9QP'
    } as RecordSearchResult
    render(<SidecarResultCard result={result} tool="record_search" defaultExpanded={true} />)
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(fs).toHaveBeenCalledTimes(1)
    expect(generic).not.toHaveBeenCalled()
  })
})

/**
 * record_read (#3594). Every non-record_search tool used to fall through to the
 * full-text card, whose title fields a record_read result does not have, so the
 * drawer showed "Untitled record" and an empty body.
 */
describe('SidecarResultCard — record_read', () => {
  const result = flynnRecordReadSidecar.payload.results![0] as unknown as RecordReadResult
  const withSources = (sources: unknown[] | undefined): RecordReadResult => ({
    ...result,
    gedcomx: { ...result.gedcomx, sources: sources as never }
  })
  const fs = vi.fn()
  const generic = vi.fn()

  beforeEach(() => {
    fs.mockClear()
    generic.mockClear()
    setOpenFamilySearch(fs)
    setOpenExternal(generic)
  })

  it('titles the card from the Record source, not "Untitled record"', () => {
    render(<SidecarResultCard result={result} tool="record_read" defaultExpanded={false} />)
    expect(
      screen.getByRole('heading', {
        name: 'Entry for Thomas Flynn and Mary Flynn, "United States, Census, 1850"'
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('Untitled record')).toBeNull()
  })

  it('renders the household persons when expanded', () => {
    render(<SidecarResultCard result={result} tool="record_read" defaultExpanded={true} />)
    for (const name of ['Thomas Flynn', 'Mary Flynn', 'Patrick Flynn']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('marks the focused persona and takes it as the primary', () => {
    render(
      <SidecarResultCard
        result={result}
        tool="record_read"
        focusPersonaId="p_3"
        defaultExpanded={true}
      />
    )
    const row = screen.getByText('Patrick Flynn').closest('[data-focused]')
    expect(row).not.toBeNull()
    expect(row!.getAttribute('data-focused')).toBe('true')
    expect(document.querySelectorAll('[data-focused="true"]')).toHaveLength(1)
    // Every member is principal; the focus, not the first principal, leads.
    const patrick = screen.getByText('Patrick Flynn')
    const thomas = screen.getByText('Thomas Flynn')
    expect(patrick.compareDocumentPosition(thomas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the citation as plain text, without literal markup', () => {
    render(<SidecarResultCard result={result} tool="record_read" defaultExpanded={false} />)
    expect(
      screen.getByText(/"United States, Census, 1850", FamilySearch \(https:/)
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('<i>')
    expect(document.querySelector('i')).toBeNull()
  })

  it('opens the Record source url through the FamilySearch channel', async () => {
    render(<SidecarResultCard result={result} tool="record_read" defaultExpanded={true} />)
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(fs).toHaveBeenCalledWith('https://www.familysearch.org/ark:/61903/1:1:MXHY-TQ2')
    expect(generic).not.toHaveBeenCalled()
  })

  it('falls back to the Collection title when there is no Record source', () => {
    render(
      <SidecarResultCard
        result={withSources([
          { id: 'sd_c_1', resource_type: 'Collection', title: 'United States, Census, 1850' }
        ])}
        tool="record_read"
        defaultExpanded={false}
      />
    )
    expect(screen.getByRole('heading', { name: 'United States, Census, 1850' })).toBeInTheDocument()
  })

  it('falls back to the first titled source when no source carries a resource_type', () => {
    // The older converter's shape: most committed record-read fixtures look like this.
    render(
      <SidecarResultCard
        result={withSources([
          { id: 's1', title: '' },
          { id: 's2', title: 'Minnesota State Census, 1885' }
        ])}
        tool="record_read"
        defaultExpanded={false}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Minnesota State Census, 1885' })
    ).toBeInTheDocument()
  })

  it('with no sources, titles from the recordId and links to it', async () => {
    render(
      <SidecarResultCard
        result={withSources(undefined)}
        tool="record_read"
        defaultExpanded={true}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Record ark:/61903/1:1:MXHY-TQ2' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(fs).toHaveBeenCalledWith('ark:/61903/1:1:MXHY-TQ2')
  })

  it('links to the recordId when the Record url is one the policy refuses', async () => {
    const sources = (result.gedcomx?.sources ?? []).map((src) =>
      src.resource_type === 'Record' ? { ...src, url: 'https://evil.example/record' } : src
    )
    render(
      <SidecarResultCard result={withSources(sources)} tool="record_read" defaultExpanded={true} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Open in FamilySearch/ }))
    expect(fs).toHaveBeenCalledWith('ark:/61903/1:1:MXHY-TQ2')
  })

  it('survives a null relationship entry', () => {
    render(
      <SidecarResultCard
        result={{ ...result, gedcomx: { ...result.gedcomx, relationships: [null] as never } }}
        tool="record_read"
        defaultExpanded={true}
      />
    )
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
  })

  it('with no principal and no focus, shows no PRIMARY pill and no relationship labels', () => {
    const persons = (result.gedcomx?.persons ?? []).map((p) => ({ ...p, principal: false }))
    render(
      <SidecarResultCard
        result={{ ...result, gedcomx: { ...result.gedcomx, persons } }}
        tool="record_read"
        defaultExpanded={true}
      />
    )
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.queryByText('Relative')).toBeNull()
    expect(screen.queryByText('PRIMARY')).toBeNull()
  })

  it('survives a malformed person without crashing', () => {
    const persons = [...(result.gedcomx?.persons ?? []), { id: 'p_9' }] as never
    render(
      <SidecarResultCard
        result={{ ...result, gedcomx: { ...result.gedcomx, persons } }}
        tool="record_read"
        defaultExpanded={true}
      />
    )
    expect(screen.getByText('Thomas Flynn')).toBeInTheDocument()
  })
})

describe('SidecarResultCard — unrouted tool', () => {
  it('renders neither "Untitled record" nor the full-text body', () => {
    render(
      <SidecarResultCard
        result={{ id: 'x', textDocument: 'SHOULD NOT RENDER', names: ['Nobody'] }}
        tool="person_read"
        defaultExpanded={true}
      />
    )
    expect(screen.getByRole('heading', { name: 'person_read' })).toBeInTheDocument()
    expect(screen.queryByText('Untitled record')).toBeNull()
    expect(screen.queryByText('SHOULD NOT RENDER')).toBeNull()
    expect(screen.queryByText('Names')).toBeNull()
  })

  it('does not present a header with nothing to expand as a button', () => {
    render(<SidecarResultCard result={{ id: 'x' }} tool="person_read" defaultExpanded={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
