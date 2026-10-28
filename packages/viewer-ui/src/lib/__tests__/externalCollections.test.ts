import { describe, it, expect } from 'vitest'
import {
  parseExternalCollections,
  groupCollections,
  countCollectionRows
} from '../externalCollections'

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    key: 'k',
    url: 'https://example.com/',
    link_text: 'A',
    record_types: ['Census'],
    place: 'P',
    cost: '',
    content_type: '',
    start_year: '',
    end_year: '',
    ...over
  }
}

describe('parseExternalCollections', () => {
  it.each([null, undefined, 'x', [], { places: [] }, { places: null }, {}])(
    'returns null for %j',
    (raw) => {
      expect(parseExternalCollections(raw)).toBeNull()
    }
  )

  it('drops a place without a rows array and a row without string url/link_text', () => {
    const doc = parseExternalCollections({
      places: {
        Good: { rows: [row({}), row({ url: 5 }), row({ link_text: null }), 'junk'] },
        NoRows: { rows: 'nope' },
        NotObject: 7
      }
    })
    expect(Object.keys(doc!.places)).toEqual(['Good'])
    expect(doc!.places.Good.rows).toHaveLength(1)
  })

  it('coerces missing string fields to "" and non-string record types away', () => {
    const doc = parseExternalCollections({
      places: { P: { rows: [{ url: 'https://x/', link_text: 'X', record_types: ['Census', 3] }] } }
    })
    const r = doc!.places.P.rows[0]
    expect(r.record_types).toEqual(['Census'])
    expect(r.cost).toBe('')
    expect(r.start_year).toBe('')
  })

  it('keeps a fetched place with no rows', () => {
    expect(parseExternalCollections({ places: { P: { rows: [] } } })!.places.P.rows).toEqual([])
  })
})

describe('groupCollections', () => {
  it('sorts places, record types and rows whatever the input order', () => {
    const doc = parseExternalCollections({
      places: {
        Zeta: { rows: [row({ link_text: 'b', record_types: ['Probate'] })] },
        Alpha: {
          rows: [
            row({ key: '2', link_text: 'z', record_types: ['Probate'] }),
            row({ key: '1', link_text: 'a', record_types: ['Probate'] }),
            row({ key: '3', link_text: 'm', record_types: ['Census'] })
          ]
        }
      }
    })
    const grouped = groupCollections(doc)
    expect(grouped.map((p) => p.place)).toEqual(['Alpha', 'Zeta'])
    expect(grouped[0].groups.map((g) => g.recordType)).toEqual(['Census', 'Probate'])
    expect(grouped[0].groups[1].rows.map((r) => r.link_text)).toEqual(['a', 'z'])
  })

  it('lists a row with two record types under both, and one with none under Other', () => {
    const doc = parseExternalCollections({
      places: {
        P: {
          rows: [
            row({ key: 'both', record_types: ['Census', 'Tax'] }),
            row({ key: 'none', record_types: [] })
          ]
        }
      }
    })
    const [place] = groupCollections(doc)
    expect(place.groups.map((g) => [g.recordType, g.rows.map((r) => r.key)])).toEqual([
      ['Census', ['both']],
      ['Other', ['none']],
      ['Tax', ['both']]
    ])
    expect(place.rowCount).toBe(2)
  })

  it('keeps an empty place with no groups', () => {
    const [place] = groupCollections(parseExternalCollections({ places: { P: { rows: [] } } }))
    expect(place).toEqual({ place: 'P', groups: [], rowCount: 0 })
  })
})

describe('countCollectionRows', () => {
  it('counts rows across places, once per row', () => {
    const doc = parseExternalCollections({
      places: { A: { rows: [row({}), row({ record_types: ['X', 'Y'] })] }, B: { rows: [row({})] } }
    })
    expect(countCollectionRows(doc)).toBe(3)
    expect(countCollectionRows(null)).toBe(0)
  })
})
