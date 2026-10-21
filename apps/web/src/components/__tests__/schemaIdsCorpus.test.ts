import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findSchemaIds, sectionForId } from '../schemaIds'

// The real reader-visible prose from the first captured hosted session
// (docs/captures/2026-09-29-mcandrew-children/, 133 min, outcome `completed`).
// ONLY the 190 paragraphs that reach the screen: chatEvents.ts:154 drops sub-agent
// prose, and counting the feed instead of the screen is what put 405 in an earlier
// draft where the truth was 193.
//
// This corpus already caught one defect the hand-written tests missed -- a slash
// rule that silently dropped the second id in `a_105/a_022`.

const PROSE = readFileSync(join(__dirname, 'fixtures', 'captured-prose.txt'), 'utf8')

describe('schema ids over the captured prose', () => {
  it('finds every measured occurrence', () => {
    const hits = findSchemaIds(PROSE)
    expect(hits.length).toBe(193)
    expect(new Set(hits.map((h) => h.id)).size).toBe(94)
  })

  it('places every distinct id in a section — none may be left homeless', () => {
    const unplaced = [...new Set(findSchemaIds(PROSE).map((h) => h.id))].filter(
      (id) => sectionForId(id) === null
    )
    expect(unplaced).toEqual([])
  })

  it('matches the measured per-prefix breakdown', () => {
    const by: Record<string, number> = {}
    for (const h of findSchemaIds(PROSE)) by[h.prefix] = (by[h.prefix] ?? 0) + 1
    expect(by).toEqual({ a: 61, pe: 47, src: 38, pli: 24, log: 14, q: 7, pl: 2 })
  })

  it('never returns an id that is not literally in the text at that offset', () => {
    for (const h of findSchemaIds(PROSE)) {
      expect(PROSE.slice(h.start, h.end)).toBe(h.id)
    }
  })
})
