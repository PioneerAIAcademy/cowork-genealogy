import { describe, it, expect } from 'vitest'
import { anchorChips, type FeedItem } from '../anchorChips'

// Phase 2 item 3. Chips and text render in the order they happened, instead of every
// chip stacking above every paragraph. Measured worst case in the captured session:
// 36 main-thread chips between two paragraphs.
//
// No direction is inferred. A heuristic that asked whether a paragraph reports the
// chips before it or announces the ones after was tried and REJECTED on the corpus:
// the opening words do not separate the two cases, and the ground-truth burst is
// announced by "Running both checks for all 18 persons at once" -- an opener no list
// built from the visible cases contained.

const T = (text: string): FeedItem => ({ kind: 'text', text })
const C = (tool: string): FeedItem => ({ kind: 'chip', tool })

describe('anchorChips', () => {
  it('keeps a paragraph with the chips that arrived before it', () => {
    const [g] = anchorChips([C('record_search'), C('record_read'), T('Found the marriage.')])
    expect(g.text).toBe('Found the marriage.')
    expect(g.chips.map((c) => c.tool)).toEqual(['record_search', 'record_read'])
  })

  it('starts a new block per paragraph, so chips never stack above everything', () => {
    const groups = anchorChips([C('a'), T('first'), C('b'), T('second')])
    expect(groups.map((g) => g.text)).toEqual(['first', 'second'])
    expect(groups.map((g) => g.chips.map((c) => c.tool))).toEqual([['a'], ['b']])
  })

  it('never gives one chip to two paragraphs', () => {
    const groups = anchorChips([T('one'), C('a'), T('two'), C('b'), T('three')])
    expect(groups.flatMap((g) => g.chips.map((c) => c.tool))).toEqual(['a', 'b'])
  })

  it('keeps every chip of a 36-chip burst — none may silently vanish', () => {
    const burst: FeedItem[] = [
      T('Running both checks for all 18 persons at once.'),
      ...Array.from({ length: 36 }, (_, i) => C(`t${i}`)),
      T('All checks are back.')
    ]
    const groups = anchorChips(burst)
    expect(groups.flatMap((g) => g.chips).length).toBe(36)
    // The burst sits with the paragraph it arrived before, not above the whole turn.
    expect(groups[1].chips.length).toBe(36)
    expect(groups[1].text).toBe('All checks are back.')
  })

  it('keeps trailing chips that no paragraph follows', () => {
    const groups = anchorChips([T('Starting.'), C('a'), C('b')])
    expect(groups.flatMap((g) => g.chips).map((c) => c.tool)).toEqual(['a', 'b'])
  })

  it('handles a feed of only chips, and an empty feed', () => {
    expect(anchorChips([C('a'), C('b')]).flatMap((g) => g.chips).length).toBe(2)
    expect(anchorChips([])).toEqual([])
  })
})
