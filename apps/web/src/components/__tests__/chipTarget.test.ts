import { describe, it, expect } from 'vitest'
import { chipTarget } from '../chipTarget'

// "It opens the card it names." Measured on the captured session: 544 of 1,009 chips
// (54%) name a schema id in their summary, and 519 of those name exactly ONE -- so
// "the card it names" is unambiguous for 95% of them.

describe('chipTarget', () => {
  it('finds the card a chip names', () => {
    expect(chipTarget('projectPath=/project, assertionId=a_046, treePersonId=I2'))
      .toEqual({ id: 'a_046', section: 'assertions' })
  })

  it('takes the FIRST named card when a chip names several', () => {
    // 25 chips in the capture name more than one. First-mentioned is the subject of
    // the call in every sample; a chip cannot open two cards at once.
    expect(chipTarget('ops=[{section: plans, entry: q_001}], also a_005')?.id).toBe('q_001')
  })

  it('returns null for a chip that names no card, so it stays unclickable', () => {
    expect(chipTarget('personId=G13G-P68, relatives=True')).toBeNull()
    expect(chipTarget('')).toBeNull()
  })

  it('returns null for an id it cannot place rather than a dead target', () => {
    expect(chipTarget('thing=zz_001')).toBeNull()
  })

  it('ignores an id inside a URL, which belongs to the link layer', () => {
    expect(chipTarget('url=https://x.test/a_001')).toBeNull()
  })

  it('reads the real shapes the capture contains', () => {
    expect(chipTarget('projectPath=/project, section=plans, op=append, entry={question_id: q_001}')?.id)
      .toBe('q_001')
    expect(chipTarget('skill=genealogy-research:research-plan, args=Build a research plan for q_001')?.section)
      .toBe('questions')
  })
})
