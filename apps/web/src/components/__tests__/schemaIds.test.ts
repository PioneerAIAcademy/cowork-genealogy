import { describe, it, expect } from 'vitest'
import { findSchemaIds, sectionForId, SCHEMA_ID_PREFIXES } from '../schemaIds'

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
