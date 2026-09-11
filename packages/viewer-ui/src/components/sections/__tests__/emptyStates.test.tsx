import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
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
      // Every <p>, not `querySelector('p')`. The first paragraph is not
      // necessarily the empty state: a section that renders a subtitle above a
      // BLANK empty state passed the single-selector version, which is exactly
      // the future case this guard exists to catch. All 14 sections render one
      // <p> today, so this is the same assertion for them.
      const paragraphs = Array.from(container.querySelectorAll('p'))
      expect(paragraphs.length).toBeGreaterThan(0)
      for (const paragraph of paragraphs) {
        expect(paragraph.textContent?.trim()).toBeTruthy()
      }
    })
  }
})

// The producer half of #2211, which the guard above deliberately cannot cover.
// Derived from docs/specs/schemas/ownership.json rather than a hand-written
// table, so a section added later with a `skill:` owner is checked here without
// an edit — the copy has to name the slug that owns the section.
//
// One prose exception. `known_holdings` is owned by `skill:init-project` but its
// copy says "when the project is initialized", which reads better and means the
// same thing. Listing it explicitly keeps the default strict: a NEW section with
// no alias must contain its own slug.
const PROSE_ALIASES: Record<string, string> = {
  known_holdings: 'project is initialized',
}

// `log` (owner null, append-only and multi-writer) and `evaluations` (owner is
// an agent, not a skill) are absent from the derived set by construction — the
// filter below takes `skill:` owners only.
const OWNERSHIP = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../../../docs/specs/schemas/ownership.json'),
    'utf8'
  )
) as { rows: { artifact: string; section: string; owner: string | null }[] }

describe('empty-state copy names the section owner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const owned = OWNERSHIP.rows.filter(
    (r) =>
      r.artifact === 'research.json' &&
      typeof r.owner === 'string' &&
      r.owner.startsWith('skill:') &&
      r.section in sectionComponents
  )

  it('covers every skill-owned section that the viewer renders', () => {
    expect(owned.length).toBeGreaterThan(0)
  })

  for (const row of owned) {
    const slug = (row.owner as string).slice('skill:'.length)
    // `${slug} step`, not the bare slug: `timeline` alone is a substring of the
    // Timelines section's own copy ("No timelines recorded"), so a bare-slug
    // assertion there passes whatever producer the copy names, or none.
    const expected = PROSE_ALIASES[row.section] ?? `${slug} step`
    it(`${row.section} names ${expected}`, () => {
      vi.mocked(useResearchData).mockReturnValue(
        buildMockContext({ research: {} as ResearchData, activeSection: row.section })
      )
      const Component = sectionComponents[row.section]
      const { container } = render(<Component />)
      expect(container.querySelector('p')?.textContent).toContain(expected)
    })
  }
})
