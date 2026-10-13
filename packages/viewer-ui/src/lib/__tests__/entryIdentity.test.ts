import { describe, it, expect } from 'vitest'
import { entryIdentity } from '../entryIdentity'

// The collapsed research-log row showed date, tool, outcome and a count — so two
// searches of the same tool on the same day were identical on screen and the reader had
// to open each one. Ruled build-it by the lead, 2026-10-13.

describe('entryIdentity', () => {
  it('reads a person as one name, not two facts', () => {
    expect(entryIdentity({ given: 'Patrick', surname: 'Flynn' })).toBe('Patrick Flynn')
  })

  it('distinguishes two searches of the same tool', () => {
    // THE case. Same tool, same day, different search — identical before this.
    const a = entryIdentity({ surname: 'Flynn', given: 'Patrick', collection: 'United States Census, 1850' })
    const b = entryIdentity({ surname: 'Flynn', given: 'Patrick', collection: 'United States Census, 1860' })
    expect(a).not.toBe(b)
  })

  it('puts who before where before when', () => {
    expect(entryIdentity({ surname: 'Flynn', place: 'Pennsylvania', year: 1850 }))
      .toBe('Flynn · Pennsylvania · 1850')
  })

  it('keeps a row to one line', () => {
    const long = entryIdentity({
      given: 'Patrick', surname: 'Flynn', place: 'Pennsylvania',
      year: 1850, collection: 'Census', title: 'Something', personId: 'ABCD-123'
    })
    expect(long.split(' · ')).toHaveLength(3)
  })

  it('says nothing rather than something empty', () => {
    // A row with no usable query falls back to what it already showed. A placeholder
    // would add a line of em-dashes to every such row.
    for (const empty of [undefined, null, {}, [], 'not an object', 42]) {
      expect(entryIdentity(empty)).toBe('')
    }
  })

  it('ignores keys it was not told to show', () => {
    // An unbounded join is how one row becomes three lines wide.
    expect(entryIdentity({ internalCursor: 'xyz', pageToken: 'abc' })).toBe('')
  })

  it('takes a number as readily as a string', () => {
    expect(entryIdentity({ year: 1881 })).toBe('1881')
  })

  it('skips blank values rather than rendering a gap', () => {
    expect(entryIdentity({ given: '  ', surname: 'Flynn', place: '' })).toBe('Flynn')
  })
})
