import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ResearchLogSection from '../ResearchLogSection'
import type { ResearchData, LogEntry } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'
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

function mockResearch(
  overrides: Partial<ResearchData> = {},
  openSidecar = vi.fn()
): { openSidecar: ReturnType<typeof vi.fn> } {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'research_log',
      openSidecar
    })
  )
  return { openSidecar }
}

describe('ResearchLogSection — collapsed "View results" affordance (Issue 1a)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders a View-results link in the collapsed row when results_ref is set', async () => {
    const { openSidecar } = mockResearch()
    render(<ResearchLogSection />)
    // log_001: examined 8, available 8 -> "View 8 results →"
    const link = screen.getByRole('button', { name: /View 8 results/ })
    await userEvent.click(link)
    expect(openSidecar).toHaveBeenCalledWith('log_001')
  })

  it('shows "View N of M results" when more were available than examined', () => {
    mockResearch()
    render(<ResearchLogSection />)
    // log_005: examined 2, available 187
    expect(screen.getByRole('button', { name: /View 2 of 187 results/ })).toBeInTheDocument()
  })

  it('shows a bare count (no link) when results_ref is null', () => {
    mockResearch()
    render(<ResearchLogSection />)
    // log_002 is an external_site entry with results_ref null and examined 12.
    expect(screen.queryByRole('button', { name: /View 12/ })).toBeNull()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('clicking the View link does not toggle the row expansion', async () => {
    mockResearch()
    render(<ResearchLogSection />)
    await userEvent.click(screen.getByRole('button', { name: /View 8 results/ }))
    // The expanded detail (Query block) for log_001 must not have opened.
    expect(screen.queryByText('Query')).toBeNull()
  })
})

describe('ResearchLogSection — linkified notes (Issue 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOpenExternal(() => {})
  })

  const entryWithUrl: LogEntry = {
    id: 'log_001',
    plan_item_id: null,
    performed: '2026-05-01T10:15:00Z',
    tool: 'record_read',
    query: { recordId: 'ark:/61903/1:1:ABC' },
    outcome: 'positive',
    results_examined: 1,
    results_ref: null,
    results_available: null,
    notes: 'Confirmed via https://www.familysearch.org/ark:/61903/1:1:ABC123 and verified.',
    external_site: null
  }

  it('renders a clickable link for a URL in an entry note', async () => {
    mockResearch({ log: [entryWithUrl] })
    render(<ResearchLogSection />)
    // Expand the row to reveal the Notes field.
    await userEvent.click(screen.getByText('record_read'))
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://www.familysearch.org/ark:/61903/1:1:ABC123')
  })
})

describe('ResearchLogSection — default sort order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to oldest-first (ascending by performed)', () => {
    mockResearch()
    render(<ResearchLogSection />)
    // patrick-flynn fixture: log_001 (2026-05-01) ... log_005 (2026-05-03).
    const earliest = screen.getByText('2026-05-01T10:15:00Z')
    const latest = screen.getByText('2026-05-03T10:00:00Z')
    // The earliest entry must render before the latest one.
    expect(
      earliest.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
