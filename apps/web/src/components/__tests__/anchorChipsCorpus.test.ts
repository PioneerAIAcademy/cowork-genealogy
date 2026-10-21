import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anchorChips, type FeedItem } from '../anchorChips'

// Replayed over the real main-thread feed of the captured session. The acceptance
// clause the plan demands ground truth for: the 36-chip burst must sit in ONE block
// with the prose it arrived with, and no chip may be lost.
const ITEMS: FeedItem[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'captured-feed-items.json'), 'utf8')
)

describe('anchoring over the captured main-thread feed', () => {
  it('has a corpus — a zero-length scan proves nothing', () => {
    expect(ITEMS.length).toBe(625)
    expect(ITEMS.filter((i) => i.kind === 'chip').length).toBe(435)
    expect(ITEMS.filter((i) => i.kind === 'text').length).toBe(190)
  })

  it('loses no chip and invents none', () => {
    const groups = anchorChips(ITEMS)
    expect(groups.flatMap((g) => g.chips).length).toBe(435)
  })

  it('keeps every paragraph exactly once', () => {
    const groups = anchorChips(ITEMS)
    expect(groups.filter((g) => g.text !== undefined).length).toBe(190)
  })

  it('breaks up the worst burst instead of stacking it above the turn', () => {
    const groups = anchorChips(ITEMS)
    const biggest = Math.max(...groups.map((g) => g.chips.length))
    // The burst still exists -- it really happened -- but it is now ONE block beside
    // its prose, not 435 chips above 190 paragraphs.
    expect(biggest).toBe(36)
    expect(groups.length).toBeGreaterThan(150)
  })
})
