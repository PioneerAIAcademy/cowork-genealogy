import { describe, it, expect } from 'vitest'
import { entryIdentity } from '../entryIdentity'

// The collapsed research-log row showed date, tool, outcome and a count — so two
// searches of the same tool on the same day were identical on screen and the reader had
// to open each one. Ruled build-it by the lead, 2026-10-13.
//
// Every query below is SNAKE_CASE, because that is what `research.json` holds. The first
// version of this file was camelCase and so was the implementation, which meant the two
// agreed with each other and with nothing else: `birth_place`, `birth_year`,
// `death_place`, `death_year` and `person_id` never matched a real document. The suite
// was green the whole time. Keep these inputs in the persisted shape.

/** The seven queries from `apps/server/app/seed/sample_project/research.json`, verbatim.
 *  Real data rather than invented shapes — that is what caught the casing bug. */
const SAMPLE = {
  census1850: { surname: 'Flynn', given: 'Patrick', birth_year: 1845, birth_place: 'Pennsylvania', collection: '1850 Census' },
  externalA:  { surname: 'Flynn', given: 'Patrick', birth_year: 1845, birth_place: 'Pennsylvania' },
  externalB:  { surname: 'Flynn', given: 'Patrick', birth_year: 1845, birth_place: 'Pennsylvania' },
  census1860: { surname: 'Flynn', given: 'Patrick', birth_year: 1845, birth_place: 'Pennsylvania', collection: '1860 Census' },
  death:      { surname: 'Flynn', given: 'Patrick', death_year: 1908, death_place: 'Schuylkill County, Pennsylvania' },
  marriage:   { surname: 'Flynn', given: 'Patrick', event_type: 'marriage', jurisdiction: 'Schuylkill County, Pennsylvania', date_range: '1865-1875' },
  father:     { surname: 'Flynn', given: 'Thomas', death_year_range: '1860-1890', death_place: 'Schuylkill County, Pennsylvania' }
}

describe('entryIdentity', () => {
  it('reads a person as one name, not two facts', () => {
    expect(entryIdentity({ given: 'Patrick', surname: 'Flynn' })).toBe('Patrick Flynn')
  })

  it('tells apart every pair of sample searches whose query differs', () => {
    // THE case, driven by the real fixture. `externalA`/`externalB` are excluded because
    // their queries are byte-identical — the same search run twice, one positive and one
    // negative — so rendering them the same is correct, not a collision.
    const distinct = ['census1850', 'census1860', 'death', 'marriage', 'father'] as const
    const lines = distinct.map((k) => entryIdentity(SAMPLE[k]))
    expect(new Set(lines).size).toBe(distinct.length)
    for (const line of lines) expect(line).not.toBe('')
  })

  it('renders the same line for two genuinely identical queries', () => {
    expect(entryIdentity(SAMPLE.externalA)).toBe(entryIdentity(SAMPLE.externalB))
  })

  it('ranks what was searched for above the subject’s own birth details', () => {
    // birth_place/birth_year repeat verbatim in every query about one person, so they
    // cannot separate that person's searches. The collection can, so it must come first
    // while only three parts fit.
    expect(entryIdentity(SAMPLE.census1850)).toBe('Patrick Flynn · 1850 Census · Pennsylvania')
    expect(entryIdentity(SAMPLE.death)).toBe('Patrick Flynn · Schuylkill County, Pennsylvania · 1908')
  })

  it('reads the camelCase a REAL hosted run writes', () => {
    // These are the actual keys and counts from the committed McAndrew capture, which
    // writes 145 camelCase keys and no snake_case ones. An earlier version of this test
    // asserted these return '' -- pinning the exact half that was broken in production,
    // which is how a green suite sat on top of rows nobody could tell apart.
    expect(entryIdentity({ givenName: 'Patrick', surname: 'Flynn', collectionId: '1325221' }))
      .toBe('Patrick Flynn · 1325221')
    expect(entryIdentity({ surname: 'Mogan', residencePlace: 'Detroit, Wayne, Michigan' }))
      .toBe('Mogan · Detroit, Wayne, Michigan')
  })

  it('still reads the snake_case the seeded sample writes', () => {
    // Both shapes are on disk: the seed fixture writes 14 snake_case keys and no camel.
    // Reading one casing only leaves whichever population it is not rendering blank.
    expect(entryIdentity(SAMPLE.census1850)).toBe('Patrick Flynn · 1850 Census · Pennsylvania')
  })

  it('does not print the same person twice when both spellings are present', () => {
    // A document carrying both would otherwise spend two of its three slots on one name.
    expect(entryIdentity({ given: 'Patrick', givenName: 'Patrick', surname: 'Flynn' }))
      .toBe('Patrick Flynn')
  })

  it('does not print the same value twice', () => {
    // `place`, `jurisdiction` and `death_place` are all "where" and often carry the same
    // string; so can `name` against `given` + `surname`. Repeating it reads as a bug and
    // burns one of only three slots.
    expect(entryIdentity({ death_place: 'Schuylkill County', jurisdiction: 'Schuylkill County' }))
      .toBe('Schuylkill County')
    expect(entryIdentity({ given: 'Patrick', surname: 'Flynn', name: 'Patrick Flynn' }))
      .toBe('Patrick Flynn')
    // ...but two genuinely different values still both show.
    expect(entryIdentity({ death_place: 'Schuylkill County', jurisdiction: 'Pennsylvania' }))
      .toBe('Schuylkill County · Pennsylvania')
  })

  it('puts who before where before when', () => {
    expect(entryIdentity({ surname: 'Flynn', place: 'Pennsylvania', year: 1850 }))
      .toBe('Flynn · Pennsylvania · 1850')
  })

  it('keeps a row to one line', () => {
    const long = entryIdentity({
      given: 'Patrick', surname: 'Flynn', place: 'Pennsylvania',
      year: 1850, collection: 'Census', title: 'Something', person_id: 'ABCD-123'
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
