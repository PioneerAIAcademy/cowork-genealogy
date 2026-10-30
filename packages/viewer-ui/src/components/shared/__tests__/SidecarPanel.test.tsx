import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SidecarPanel from '../SidecarPanel'
import { patrickFlynnSidecar } from '../../../lib/__fixtures__/patrick-flynn-sidecar'
import { flynnRecordReadSidecar } from '../../../lib/__fixtures__/flynn-record-read-sidecar'
import { externalLinksSidecar } from '../../../lib/__fixtures__/external-links-sidecar'
import type { SidecarState } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

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

// The real card, except a result whose recordId is THROW_ID throws on render —
// the stand-in for any future payload the card cannot handle. Named exports
// (ROUTED_TOOLS) pass through, so every other test here uses the real card.
const THROW_ID = vi.hoisted(() => '__throw__')
vi.mock('../SidecarResultCard', async () => {
  const actual = await vi.importActual<typeof import('../SidecarResultCard')>('../SidecarResultCard')
  const RealCard = actual.default
  return {
    ...actual,
    default: (props: Parameters<typeof RealCard>[0]) => {
      if ((props.result as { recordId?: string }).recordId === THROW_ID) {
        throw new Error('card render exploded')
      }
      return <RealCard {...props} />
    }
  }
})

function mountWithState(
  sidecar: SidecarState,
  extras: Partial<Parameters<typeof buildMockContext>[0]> = {}
): {
  openSidecar: ReturnType<typeof vi.fn>
  closeSidecar: ReturnType<typeof vi.fn>
  clearFocusPersona: ReturnType<typeof vi.fn>
} {
  const openSidecar = vi.fn()
  const closeSidecar = vi.fn()
  const clearFocusPersona = vi.fn()
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      sidecar,
      openSidecar,
      closeSidecar,
      clearFocusPersona,
      ...extras
    })
  )
  return { openSidecar, closeSidecar, clearFocusPersona }
}

describe('SidecarPanel — status branches', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when status is closed', () => {
    mountWithState({ status: 'closed' })
    const { container } = render(<SidecarPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders header + loading message when status is loading', () => {
    mountWithState({ status: 'loading', logId: 'log_042' })
    render(<SidecarPanel />)
    expect(screen.getByText('Record Search Results')).toBeInTheDocument()
    expect(screen.getByText('log_042')).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders missing-file copy when status is missing', () => {
    mountWithState({ status: 'missing', logId: 'log_042' })
    render(<SidecarPanel />)
    expect(screen.getByText('Results file not found')).toBeInTheDocument()
    expect(screen.getByText(/results\/log_042\.json/)).toBeInTheDocument()
  })

  it('renders error block + Try again button when status is error', async () => {
    const { openSidecar, closeSidecar } = mountWithState({
      status: 'error',
      logId: 'log_042',
      error: 'Sidecar exceeds 10MB cap'
    })
    render(<SidecarPanel />)
    expect(screen.getByText("Couldn't load results")).toBeInTheDocument()
    expect(screen.getByText('Sidecar exceeds 10MB cap')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(openSidecar).toHaveBeenCalledWith('log_042')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('renders the result card body when status is loaded', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    // Header
    expect(screen.getByText('Record Search Results')).toBeInTheDocument()
    expect(screen.getByText('log_001')).toBeInTheDocument()
    // Summary strip
    expect(screen.getByText(/TOOL\s+record_search/)).toBeInTheDocument()
    // The first card title (from the fixture)
    expect(screen.getByText('New York State Census, 1865')).toBeInTheDocument()
    // PRIMARY pill renders because Patrick (P1) is the primary
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    // Persons subview shows household members in order
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.getByText('Mary Flynn')).toBeInTheDocument()
    expect(screen.getByText('Thomas Flynn')).toBeInTheDocument()
    expect(screen.getByText('Bridget Flynn')).toBeInTheDocument()
    // Relationship labels render as the raw word (CSS uppercases visually)
    expect(screen.getByText('Wife')).toBeInTheDocument()
    expect(screen.getByText('Father')).toBeInTheDocument()
    expect(screen.getByText('Mother')).toBeInTheDocument()
  })

  it('renders the MATCHED pill on the focused person', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      focusPersonaId: 'P2', // Mary
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('MATCHED')).toBeInTheDocument()
  })

  it('renders the empty-results message when payload has no results', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_999',
      payload: { ...patrickFlynnSidecar, payload: { results: [] }, returned_count: 0 },
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('This search returned no results.')).toBeInTheDocument()
  })

  it('renders treeMatches when present and non-empty', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByText('Tree matches')).toBeInTheDocument()
    // The engine sends only a PID and a star count, so those are what render.
    expect(screen.getByText('KW7C-X9P')).toBeInTheDocument()
    expect(screen.getByText('LZ5J-2RT')).toBeInTheDocument()
    // Both stars asserted: without these, dropping the stars expression is green.
    expect(screen.getByText('5/5')).toBeInTheDocument()
    expect(screen.getByText('3/5')).toBeInTheDocument()
  })
})

// #3893: a result card that throws used to unmount the whole viewer, because the
// drawer sat outside every ErrorBoundary.
describe('SidecarPanel — a result that fails to render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('contains the failure to its card and leaves the drawer closable', async () => {
    const good = patrickFlynnSidecar.payload.results![0]
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_002',
      payload: {
        ...patrickFlynnSidecar,
        log_id: 'log_002',
        returned_count: 2,
        payload: { results: [{ ...good, recordId: THROW_ID }, good] }
      },
      lastMtime: 1
    })
    render(<SidecarPanel />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t display this result')
    expect(alert).toHaveTextContent('results/log_002.json could not be displayed')
    // The good result next to it still renders (collapsed: only the first expands).
    expect(screen.getByText('New York State Census, 1865')).toBeInTheDocument()
    // The drawer header and its Close button survive and still work.
    expect(screen.getByText('Record Search Results')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close sidecar' }))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('clears the failed card when the same log is re-read after a write', () => {
    const good = patrickFlynnSidecar.payload.results![0]
    const loaded = (results: (typeof good)[], lastMtime: number): SidecarState => ({
      status: 'loaded',
      logId: 'log_002',
      payload: { ...patrickFlynnSidecar, payload: { results } },
      lastMtime
    })
    mountWithState(loaded([{ ...good, recordId: THROW_ID }], 1))
    const { rerender } = render(<SidecarPanel />)
    // A lone result: no mention of "other results" that don't exist.
    expect(screen.getByRole('alert')).toHaveTextContent('The Close button still works.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('other results')

    // Same logId, newer mtime — what the provider sets when the file changes.
    mountWithState(loaded([good], 2))
    rerender(<SidecarPanel />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
  })

  it('contains a payload that breaks the drawer body, keeping Close working', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_002',
      payload: { ...patrickFlynnSidecar, payload: undefined } as never,
      lastMtime: 1
    })
    render(<SidecarPanel />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t display these results')
    expect(alert).toHaveTextContent('results/log_002.json could not be displayed')
    await userEvent.click(screen.getByRole('button', { name: 'Close sidecar' }))
    expect(closeSidecar).toHaveBeenCalled()
  })
})

describe('SidecarPanel — dismiss affordances', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking the X button calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByRole('button', { name: 'Close sidecar' }))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('clicking the backdrop calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByTestId('sidecar-backdrop'))
    expect(closeSidecar).toHaveBeenCalled()
  })

  it('pressing Escape calls closeSidecar', async () => {
    const { closeSidecar } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.keyboard('{Escape}')
    expect(closeSidecar).toHaveBeenCalled()
  })
})

describe('SidecarPanel — clearFocusPersona', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clicking inside the drawer body clears focusPersonaId', async () => {
    const { clearFocusPersona } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      focusPersonaId: 'P2',
      lastMtime: 1
    })
    render(<SidecarPanel />)
    // Click the drawer dialog itself (not the close button, not the backdrop)
    await userEvent.click(screen.getByRole('dialog'))
    expect(clearFocusPersona).toHaveBeenCalled()
  })

  it('does not call clearFocusPersona when focusPersonaId is already absent', async () => {
    const { clearFocusPersona } = mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: patrickFlynnSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(clearFocusPersona).not.toHaveBeenCalled()
  })
})

/** Routing by tool (#3594): every non-record_search tool used to get the full-text card. */
describe('SidecarPanel — routing by tool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens a record_read sidecar expanded, with its title and household', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_001',
      payload: flynnRecordReadSidecar,
      focusPersonaId: 'p_3',
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByRole('heading', { level: 2, name: 'Record' })).toBeInTheDocument()
    expect(
      screen.getByText('Entry for Thomas Flynn and Mary Flynn, "United States, Census, 1850"')
    ).toBeInTheDocument()
    expect(screen.getByText('Patrick Flynn')).toBeInTheDocument()
    expect(screen.getByText('Mary Flynn')).toBeInTheDocument()
    expect(document.querySelector('[data-focused="true"]')?.textContent).toContain('Patrick Flynn')
    expect(screen.getByRole('button', { name: /Open in FamilySearch/ })).toBeInTheDocument()
    expect(screen.queryByText('Untitled record')).toBeNull()
  })

  it('lists external_links_search links under an External Links header', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_007',
      payload: externalLinksSidecar,
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(screen.getByRole('heading', { level: 2, name: 'External Links' })).toBeInTheDocument()
    expect(screen.getByText('United States Records')).toBeInTheDocument()
    expect(screen.getByText('Schuylkill County archive')).toBeInTheDocument()
    expect(screen.queryByText('Untitled record')).toBeNull()
  })

  it('renders a neutral note for any other tool, never a result card', () => {
    mountWithState({
      status: 'loaded',
      logId: 'log_012',
      payload: {
        log_id: 'log_012',
        tool: 'person_read',
        retrieved: '2026-09-30T12:00:00Z',
        returned_count: 2,
        payload: { results: [{ id: 'a' }, { id: 'b' }] as never }
      },
      lastMtime: 1
    })
    render(<SidecarPanel />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'person_read results' })
    ).toBeInTheDocument()
    expect(screen.getByText(/person_read returned 2 results\./)).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
    expect(document.querySelector('article')).toBeNull()
    expect(screen.queryByText('Untitled record')).toBeNull()
  })
})
