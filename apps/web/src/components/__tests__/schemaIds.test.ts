import { describe, it, expect } from 'vitest'
import { resolveFamilySearchTarget, imageIdToViewerUrl } from '@genealogy/viewer-ui'
import {
  findSchemaIds,
  sectionForId,
  SCHEMA_ID_PREFIXES,
  findFamilySearchTargets
} from '../schemaIds'

/** The two resolvers SchemaIdText passes in, so the scanner is exercised as it runs. */
const find = (text: string): ReturnType<typeof findFamilySearchTargets> =>
  findFamilySearchTargets(text, resolveFamilySearchTarget, imageIdToViewerUrl)
const FS = 'https://www.familysearch.org/'

// Phase 2 item 1. Measured on the first captured hosted session
// (docs/captures/2026-09-29-mcandrew-children/): 193 schema-id occurrences, 94
// distinct, reach the READER across 190 rendered paragraphs -- a_ 61, pe_ 47,
// src_ 38, pli_ 24, log_ 14, q_ 7, pl_ 2. Every one is dead text today.
//
// "src_" and "log_" are in scope deliberately: an earlier count omitted them and
// under-reported the total by a quarter, and src_ ids are exactly the source cards
// a reader most wants to open.

describe('findSchemaIds', () => {
  it('finds every prefix the capture actually contains', () => {
    for (const p of ['q', 'pl', 'pli', 'a', 'pe', 'src', 'log']) {
      const hits = findSchemaIds(`see ${p}_001 for detail`)
      expect(hits.map((h) => h.id), `prefix ${p}_ must be recognised`).toEqual([`${p}_001`])
    }
  })

  it('reports each occurrence with its position, so text can be split around it', () => {
    const hits = findSchemaIds('a_001 then pe_014')
    expect(hits).toEqual([
      { id: 'a_001', prefix: 'a', start: 0, end: 5 },
      { id: 'pe_014', prefix: 'pe', start: 11, end: 17 }
    ])
  })

  it('prefers the LONGEST prefix, so pli_ is not read as pl_', () => {
    const [hit] = findSchemaIds('item pli_003')
    expect(hit.id).toBe('pli_003')
    expect(hit.prefix).toBe('pli')
  })

  it('does not match inside a longer word', () => {
    expect(findSchemaIds('xa_001')).toEqual([])
    expect(findSchemaIds('a_001x')).toEqual([])
    expect(findSchemaIds('media_001')).toEqual([])
  })

  it('leaves unknown prefixes and malformed ids alone', () => {
    expect(findSchemaIds('zz_001 a_ a_12 a_1234')).toEqual([])
  })

  it('is not confused by an id inside a URL or a code span', () => {
    // A URL is Linkify's job; claiming it here would produce a link inside a link.
    expect(findSchemaIds('https://x.test/a_001')).toEqual([])
  })
})

describe('sectionForId', () => {
  it('routes each prefix to the section that holds it', () => {
    expect(sectionForId('q_001')).toBe('questions')
    expect(sectionForId('pl_001')).toBe('plans')
    expect(sectionForId('pli_001')).toBe('plans')   // an item lives in its plan
    expect(sectionForId('a_001')).toBe('assertions')
    expect(sectionForId('pe_001')).toBe('person_evidence')
    expect(sectionForId('src_001')).toBe('sources')
    expect(sectionForId('log_001')).toBe('log')
  })

  it('returns null for anything it cannot place, so the text stays plain', () => {
    expect(sectionForId('zz_001')).toBeNull()
  })

  it('covers every prefix it claims to know', () => {
    for (const p of SCHEMA_ID_PREFIXES) {
      expect(sectionForId(`${p}_001`), `${p}_ has no section`).not.toBeNull()
    }
  })
})

describe('shapes taken from the captured corpus, not invented', () => {
  it('finds BOTH ids in a slash-separated pair', () => {
    // Verbatim from the capture: "...to resolve a_105/a_022. Reading the com..."
    // An earlier guard excluded any id preceded by "/", which silently dropped the
    // second one. The corpus caught what the hand-written tests did not.
    expect(findSchemaIds('to resolve a_105/a_022.').map((h) => h.id)).toEqual(['a_105', 'a_022'])
  })

  it('still refuses an id that is genuinely inside a URL', () => {
    expect(findSchemaIds('see https://x.test/path/a_001 now')).toEqual([])
  })

  it('handles an id adjacent to a URL without swallowing either', () => {
    const hits = findSchemaIds('a_007 at https://x.test/a_009 and pe_003')
    expect(hits.map((h) => h.id)).toEqual(['a_007', 'pe_003'])
  })
})

describe('findFamilySearchTargets (#4582)', () => {
  it('resolves a bare ARK to its FamilySearch URL', () => {
    const [hit] = find('Sources consulted: ark:/61903/3:1:3Q9M-CS56-DQGC-1')
    expect(hit.raw).toBe('ark:/61903/3:1:3Q9M-CS56-DQGC-1')
    expect(hit.href).toBe(`${FS}ark:/61903/3:1:3Q9M-CS56-DQGC-1`)
  })

  it('trims a sentence-final period off an ARK instead of folding it into the link', () => {
    // `.` is legal in the ARK id charset, so the greedy match grabs it; the link must
    // stop at the id and leave the period as prose.
    const hits = find('See ark:/61903/3:1:3Q9M-CS56-DQGC-1.')
    expect(hits).toHaveLength(1)
    expect(hits[0].raw).toBe('ark:/61903/3:1:3Q9M-CS56-DQGC-1')
    expect(hits[0].href).toBe(`${FS}ark:/61903/3:1:3Q9M-CS56-DQGC-1`)
    expect(hits[0].end).toBe('See ark:/61903/3:1:3Q9M-CS56-DQGC-1'.length) // period excluded
  })

  it('resolves an image id to the film viewer with i one less than the page number', () => {
    const [hit] = find('image 004567123_00058 of the film')
    expect(hit.raw).toBe('004567123_00058')
    expect(hit.href).toBe(`${FS}search/film/004567123?i=57`)
  })

  it('never links a look-alike host that only starts with familysearch.org', () => {
    // Pins the `/` after `.org` in SCHEMELESS_FS_URL_RE — the guard that keeps every
    // scheme-less link on familysearch.org. Remove that `/` and this becomes a live
    // link to https://familysearch.org.evil.com/login.
    expect(find('see familysearch.org.evil.com/login there')).toEqual([])
  })

  it('links a scheme-less familysearch.org address', () => {
    const [hit] = find('open familysearch.org/search/film/004567123?i=57 to see it')
    expect(hit.href).toBe(`${FS.replace('www.', '')}search/film/004567123?i=57`)
  })

  it('leaves a bare image-GROUP number (no underscore) alone', () => {
    expect(find('image group 113551215 in the catalog')).toEqual([])
  })

  it('leaves a bare person id alone — it is never scanned as a target', () => {
    // A record id shares this shape; linking a bare one could open the wrong page.
    expect(find('person KW7C-X9P in the tree')).toEqual([])
  })

  it('does not double-link an ARK that already sits inside a full URL', () => {
    expect(find('See https://www.familysearch.org/ark:/61903/3:1:ABCD-1 now')).toEqual([])
  })

  it('claims a scheme-less FS URL once, not also the ARK nested inside it', () => {
    const hits = find('at www.familysearch.org/ark:/61903/3:1:ABCD-1 today')
    expect(hits).toHaveLength(1)
    expect(hits[0].href).toBe(`${FS}ark:/61903/3:1:ABCD-1`)
  })

  it('reports every target in order with its span, so prose can be split around it', () => {
    const hits = find('ark:/61903/3:1:ABCD-1 and 004567123_00058')
    expect(hits.map((h) => h.raw)).toEqual(['ark:/61903/3:1:ABCD-1', '004567123_00058'])
    expect(hits[0].start).toBe(0)
    expect(hits[1].start).toBe('ark:/61903/3:1:ABCD-1 and '.length)
  })
})
