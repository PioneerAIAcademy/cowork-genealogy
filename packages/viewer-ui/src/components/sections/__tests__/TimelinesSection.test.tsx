import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimelinesSection from '../TimelinesSection'
import type { ResearchData, Timeline } from '../../../lib/schema'
import { patrickFlynnResearch, patrickFlynnGedcomx } from '../../../lib/__fixtures__/patrick-flynn'

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
      gedcomx: patrickFlynnGedcomx,
      activeSection: 'timelines'
    })
  )
}

// The TimelinesSection wraps each timeline in a Card that defaults to
// collapsed. Click the chevron's header to expand the body.
async function expandFirstCard(): Promise<void> {
  const chevrons = screen.getAllByText(/^[▾▸]$/)
  if (chevrons.length === 0) throw new Error('No card chevrons found')
  const header = chevrons[0].closest('div')?.parentElement
  if (!header) throw new Error('No header element found')
  await userEvent.click(header)
}

describe('TimelinesSection — B5 conflict chip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the conflict chip when an event has conflict_ids', async () => {
    mockResearch()
    render(<TimelinesSection />)
    await expandFirstCard()
    // Fixture: the 1850 census event has conflict_ids: ['c_001'] + a note.
    expect(screen.getByText('Conflict (1)')).toBeInTheDocument()
    expect(screen.getByText(/Death certificate gives a different father/)).toBeInTheDocument()
  })

  it('renders each conflict id as a CrossLink', async () => {
    mockResearch()
    render(<TimelinesSection />)
    await expandFirstCard()
    expect(screen.getByText('c_001')).toBeInTheDocument()
  })

  it('omits the chip on events without conflict_ids', async () => {
    // Override the fixture timeline to remove the conflict on the 1850 event.
    const tl: Timeline = {
      ...patrickFlynnResearch.timelines[0],
      events: patrickFlynnResearch.timelines[0].events.map((e) => ({
        ...e,
        conflict_ids: null,
        conflict_note: null
      }))
    }
    mockResearch({ timelines: [tl] })
    render(<TimelinesSection />)
    await expandFirstCard()
    expect(screen.queryByText(/^Conflict \(/)).toBeNull()
  })

  it('omits the chip when conflict_ids is an empty array', async () => {
    const tl: Timeline = {
      ...patrickFlynnResearch.timelines[0],
      events: patrickFlynnResearch.timelines[0].events.map((e) => ({
        ...e,
        conflict_ids: [],
        conflict_note: null
      }))
    }
    mockResearch({ timelines: [tl] })
    render(<TimelinesSection />)
    await expandFirstCard()
    expect(screen.queryByText(/^Conflict \(/)).toBeNull()
  })
})

describe('TimelinesSection — B6 gap notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders gap notes italic when present', async () => {
    mockResearch()
    render(<TimelinesSection />)
    await expandFirstCard()
    expect(screen.getByText(/Probate, naturalization, and city directories/)).toBeInTheDocument()
  })

  it('omits notes when gap.notes is null', async () => {
    const tl: Timeline = {
      ...patrickFlynnResearch.timelines[0],
      gaps: patrickFlynnResearch.timelines[0].gaps.map((g) => ({ ...g, notes: null }))
    }
    mockResearch({ timelines: [tl] })
    render(<TimelinesSection />)
    await expandFirstCard()
    expect(screen.queryByText(/Probate, naturalization/)).toBeNull()
  })
})
