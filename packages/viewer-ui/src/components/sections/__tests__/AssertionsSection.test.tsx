import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssertionsSection from '../AssertionsSection'
import type { Assertion, ResearchData } from '../../../lib/schema'
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
import { expandCardByTitle } from './expandCard'

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
    expect(screen.getByText(/No assertions yet\./)).toBeInTheDocument()
    expect(screen.getByText(/record-extraction step/)).toBeInTheDocument()
  })

  it('renders an assertion missing record_basis without crashing', () => {
    const oldAssertion = {
      id: 'a_old',
      source_id: 'src_001',
      record_id: 'ark:/61903/1:1:MXYZ',
      record_role: 'child_1',
      fact_type: 'name',
      value: 'Patrick Flynn',
      information_quality: 'indeterminate',
      informant: 'Unknown',
      informant_proximity: 'unknown',
      log_entry_id: null,
      extracted_for_question_ids: ['q_002']
      // no record_basis — old document shape
    } as unknown as Assertion
    mockResearch({ assertions: [oldAssertion] })
    expect(() => render(<AssertionsSection />)).not.toThrow()
    expect(screen.getByText('name: Patrick Flynn')).toBeInTheDocument()
  })

  it('excludes undefined from the evidence-type dropdown when record_basis is missing', () => {
    const withBasis = patrickFlynnResearch.assertions![0]
    const withoutBasis = {
      id: 'a_old',
      source_id: 'src_001',
      record_id: 'ark:/61903/1:1:MXYZ',
      record_role: 'child_1',
      fact_type: 'name',
      value: 'Patrick Flynn',
      information_quality: 'indeterminate',
      informant: 'Unknown',
      informant_proximity: 'unknown',
      log_entry_id: null,
      extracted_for_question_ids: ['q_002']
    } as unknown as Assertion
    mockResearch({ assertions: [withBasis, withoutBasis] })
    render(<AssertionsSection />)
    const select = screen.getAllByRole('combobox')[1] // Evidence Type dropdown
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(options).not.toContain('undefined')
    expect(options).not.toContain('')
    // "All" plus only the valid record_basis values
    expect(options[0]).toBe('All')
    expect(options.length).toBeGreaterThanOrEqual(2)
  })
})
