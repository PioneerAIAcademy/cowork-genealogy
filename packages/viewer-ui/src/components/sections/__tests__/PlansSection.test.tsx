import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlansSection from '../PlansSection'
import type { ResearchData } from '../../../lib/schema'
import { patrickFlynnResearch } from '../../../lib/__fixtures__/patrick-flynn'
import { expandCardByTitle } from './expandCard'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

function mockResearch(overrides: Partial<ResearchData> = {}): void {
  vi.mocked(useResearchData).mockReturnValue(
    buildMockContext({
      research: { ...patrickFlynnResearch, ...overrides },
      activeSection: 'plans'
    })
  )
}

describe('PlansSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows a plan item's collection_url as a link", async () => {
    const url = 'https://www.ancestry.com/search/collections/7163/'
    const [plan] = patrickFlynnResearch.plans
    const [first, ...rest] = plan.items
    const items: typeof plan.items = [{ ...first, collection_url: url }, ...rest]
    mockResearch({ plans: [{ ...plan, items }] })
    render(<PlansSection />)
    await expandCardByTitle(plan.id)
    expect(screen.getByText(url).closest('a')).not.toBeNull()
  })
})
