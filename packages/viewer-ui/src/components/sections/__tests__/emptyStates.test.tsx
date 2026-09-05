import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { ResearchData } from '../../../lib/schema'
import { sectionComponents } from '../../../App'
import { buildMockContext } from '../../../contexts/__tests__/mockContext'

vi.mock('../../../contexts/ResearchDataContext', async () => {
  const actual = await vi.importActual<typeof import('../../../contexts/ResearchDataContext')>(
    '../../../contexts/ResearchDataContext'
  )
  return { ...actual, useResearchData: vi.fn() }
})

import { useResearchData } from '../../../contexts/ResearchDataContext'

// Guard for issue #2211: every registered section must render SOME empty-state
// text when its data is absent, so a section can no longer ship a blank empty
// state while CI stays green. Iterating sectionComponents (rather than a
// hand-written list) means a section added later is covered by this test with no
// further edit.
//
// What this proves and what it does not: it asserts an empty-state string is
// PRESENT. It cannot prove the producer that string names is the correct one —
// that rests on each section's copy following docs/specs/schemas/ownership.json
// and on review. The assertion targets the empty-state <p> itself, not the
// container's aggregate text, because every section renders its <h2> title
// unconditionally above the guard; asserting on the whole container would stay
// green even if the <p> string were deleted.
describe('section empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  for (const [key, Component] of Object.entries(sectionComponents)) {
    it(`${key} renders non-empty empty-state text for an all-empty project`, () => {
      vi.mocked(useResearchData).mockReturnValue(
        buildMockContext({ research: {} as ResearchData, activeSection: key })
      )
      const { container } = render(<Component />)
      const paragraph = container.querySelector('p')
      expect(paragraph?.textContent?.trim()).toBeTruthy()
    })
  }
})
