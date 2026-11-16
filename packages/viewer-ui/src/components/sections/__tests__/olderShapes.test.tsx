import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { GedcomxData, ResearchData } from '../../../lib/schema'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'
import { patrickFlynnGedcomx, patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'
import PlansSection from '../PlansSection'
import ProjectOverview from '../ProjectOverview'
import ProofSummariesSection from '../ProofSummariesSection'
import ResearchLogSection from '../ResearchLogSection'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'

// Shapes committed e2e end states really hold (eval/runlogs/e2e/william-ferber-origins,
// mckee-birth-1904), which made these sections throw. Readers tolerate them; nothing
// repairs them.

function withResearch(patch: Partial<Record<keyof ResearchData, unknown>>): ResearchData {
  return { ...structuredClone(patrickFlynnResearch), ...patch } as ResearchData
}

function renders(Section: () => React.JSX.Element, research: ResearchData, gedcomx: GedcomxData = patrickFlynnGedcomx) {
  vi.mocked(useResearchData).mockReturnValue(buildMockContext({ research, gedcomx }))
  const { container } = render(<Section />)
  expect(container.querySelector('h2')).not.toBeNull()
}

describe('older document shapes', () => {
  it('a plan with no items', () => {
    const plans = [{ id: 'pl_001', question_id: 'q_001', status: 'active', created: '2026-07-29' }]
    renders(PlansSection, withResearch({ plans }))
    renders(ResearchLogSection, withResearch({ plans }))
  })

  it('log entries with none of today’s fields', () => {
    const log = [
      { id: 'log_001', date: '2026-07-29', outcome: 'negative', search_description: 'Census, 1850' },
      { id: 'log_002', date: '2026-07-29', search_type: 'record' }
    ]
    renders(ResearchLogSection, withResearch({ log }))
  })

  it('a proof summary with no assertion or conflict ids', () => {
    const proof_summaries = [{ id: 'ps_001', question_id: 'q_001', tier: 'probable', narrative_markdown: 'Born 1850.' }]
    renders(ProofSummariesSection, withResearch({ proof_summaries }))
  })

  it("a tree fact holding full GedcomX's { original } date and place", () => {
    const gedcomx = structuredClone(patrickFlynnGedcomx) as unknown as { persons: Array<{ facts?: unknown[] }> }
    gedcomx.persons[0].facts = [
      { type: 'Birth', date: { original: 'January–March 1904', formal: '+1904' }, place: { original: 'Banbridge' } }
    ]
    vi.mocked(useResearchData).mockReturnValue(
      buildMockContext({ gedcomx: gedcomx as unknown as GedcomxData })
    )
    const { container } = render(<ProjectOverview />)
    expect(container.textContent).toContain('b. January–March 1904, Banbridge')
  })
})
