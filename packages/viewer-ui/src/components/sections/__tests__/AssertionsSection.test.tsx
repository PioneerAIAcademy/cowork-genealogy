import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssertionsSection from '../AssertionsSection'
import type { ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'

// Mock the context module so we can drive the section with arbitrary
// research data without standing up a provider.
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
      activeSection: 'assertions'
    })
  )
}

// Helper: cards collapse by default. Find the card with the given title
// and click its header to expand the body where the Persona row lives.
async function expandCardByTitle(title: string): Promise<void> {
  const titleEl = screen.getAllByText(title)[0]
  // The header is the parent of the title element
  const header = titleEl.parentElement
  if (!header) throw new Error(`No header found for title "${title}"`)
  await userEvent.click(header)
}

describe('AssertionsSection — B1 persona row', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the persona row when record_persona_id is present', async () => {
    mockResearch()
    render(<AssertionsSection />)
    // a_001 fixture entry has record_persona_id: 'P1'
    await expandCardByTitle('name: Patrick Flynn')
    expect(screen.getByText('Persona')).toBeInTheDocument()
    expect(screen.getByText('P1')).toBeInTheDocument()
  })

  it('omits the persona row when record_persona_id is null/undefined', async () => {
    // a_002 fixture entry has no record_persona_id; expanding its card
    // must not surface a Persona label.
    mockResearch()
    render(<AssertionsSection />)
    await expandCardByTitle('birth: age 5')
    expect(screen.queryByText('Persona')).toBeNull()
  })

  it('renders persona id in monospace <code> styling', async () => {
    mockResearch()
    render(<AssertionsSection />)
    await expandCardByTitle('name: Patrick Flynn')
    const persona = screen.getByText('P1')
    expect(persona.tagName.toLowerCase()).toBe('code')
  })

  it('renders an empty message when there are no assertions', () => {
    mockResearch({ assertions: [] })
    render(<AssertionsSection />)
    expect(screen.getByText('No assertions yet.')).toBeInTheDocument()
  })
})
