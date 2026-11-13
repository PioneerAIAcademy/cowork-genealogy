import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ResearchDocument } from '../contract'
import { leftoverIds } from '../rules/id-check'
import { COMPOUND, MCANDREW, compound, mcandrew } from '../rules/test-data'
import { labelWords, pagesWithContent, queryWords, resultsView, searchFile, sourcePeople, toolWords } from './model'

const research = (docs: { research: unknown }) => docs.research as ResearchDocument
const REPO = resolve(process.cwd(), '../..')
const results = (path: string) => JSON.parse(readFileSync(`${REPO}/${path}`, 'utf-8'))
const logEntry = (docs: { research: unknown }, id: string) => research(docs).log!.find((e) => e.id === id)!

describe('a log entry in words', () => {
  it('names a record read by its title, never its ARK (McAndrew log_010)', () => {
    const words = queryWords(logEntry(MCANDREW, 'log_010').query, mcandrew)
    expect(words.plain.join(' ')).not.toContain('ark:/')
    expect(leftoverIds(words.plain.join(' '))).toEqual([])
  })

  it('drops a collection id and keeps names, places and years (McAndrew log_002)', () => {
    const words = queryWords(logEntry(MCANDREW, 'log_002').query, mcandrew).plain.join(' ')
    expect(words).not.toContain('1325221')
    expect(words).toContain('Mogan')
  })

  it('a record search: the names, the place and the years as one range', () => {
    const words = queryWords(logEntry(COMPOUND, 'log_002').query, compound).plain
    expect(words).toEqual(['Elizabeth Barker', 'United States', 'Mississippi', '1820–1827'])
  })

  it('names the tool in words, and another website by its site', () => {
    expect(toolWords(logEntry(COMPOUND, 'log_002'))).toBe('FamilySearch records')
    expect(toolWords({ tool: 'external_site', external_site: { site: 'ancestry' } } as never)).toBe('Another website: ancestry')
    expect(toolWords({ tool: 'geneteka_search' } as never)).toBe('Geneteka search')
    expect(labelWords('marital_status')).toBe('Marital status')
  })
})

describe('a source and the people it names', () => {
  it('each person once, at the strongest of their live links', () => {
    const r = structuredClone(research(COMPOUND))
    const pe = r.person_evidence!
    const first = pe[0]
    const otherAssertion = r.assertions!.find((a) => a.source_id === r.assertions!.find((b) => b.id === first.assertion_id)!.source_id && a.id !== first.assertion_id)!
    pe.push({ ...first, id: 'pe_900', assertion_id: otherAssertion.id, confidence: 'confident' })
    pe.push({ ...first, id: 'pe_901', assertion_id: otherAssertion.id, confidence: 'speculative' })
    const sourceId = r.assertions!.find((a) => a.id === first.assertion_id)!.source_id
    const person = sourcePeople(r, sourceId).find((p) => p.personId === first.person_id)
    expect(person?.confidence).toBe('confident')
  })

  it('a retired link or assertion names no one', () => {
    const r = structuredClone(research(COMPOUND))
    const sourceId = r.sources![0].id
    const before = sourcePeople(r, sourceId).length
    expect(before).toBeGreaterThan(0)
    for (const a of r.assertions!) if (a.source_id === sourceId) a.superseded_by = 'a_999'
    expect(sourcePeople(r, sourceId)).toEqual([])
  })
})

describe("a search's results, by the tool that wrote them", () => {
  it('record_search rows: the person, the record, its events, and the persona ARK', () => {
    const view = resultsView(results('eval/fixtures/scenarios/compound-objective-fully-covered/results/log_002.json'))
    expect(view.rows.length).toBeGreaterThan(0)
    expect(view.rows[0].familySearch).toMatch(/^ark:\/61903\/1:1:/)
  })

  it.each([
    ['fulltext_search', 'eval/fixtures/scenarios/flynn-birthplace-conflict-stated/results/log_004.json'],
    ['record_read', 'eval/fixtures/scenarios/barker-parents-concluded-unlinked/results/log_027.json'],
    ['external_links_search', 'eval/fixtures/scenarios/gaetjen-namesake-confident-link/results/log_001.json'],
    ['image_transcribe', 'eval/fixtures/scenarios/gaetjen-namesake-confident-link/results/log_007.json']
  ])('%s draws rows', (_tool, path) => {
    const view = resultsView(results(path))
    expect(view.notShown).toBeUndefined()
    expect(view.rows.length).toBeGreaterThan(0)
    for (const row of view.rows) {
      if (row.outside) expect(row.outside).toMatch(/^https:\/\//)
    }
  })

  it('an unknown tool says how many it holds, and shows none', () => {
    expect(resultsView({ tool: 'mystery', payload: { results: [{}, {}] } })).toEqual({ rows: [], notShown: 2 })
  })
})

describe('the file', () => {
  it('shows a page only when it has content', () => {
    expect(pagesWithContent(research(COMPOUND), null)).toEqual(['sources', 'log'])
    expect(pagesWithContent({}, null)).toEqual([])
    expect(pagesWithContent({}, { places: { Ohio: { rows: [] } } })).toEqual(['sources'])
  })

  it('the search box finds a record by its citation and a person by name', () => {
    const hits = searchFile(research(COMPOUND), compound, 'turnbow')
    expect(hits.some((h) => h.target.kind === 'person')).toBe(true)
    const census = searchFile(research(COMPOUND), compound, 'Jasper')
    expect(census.some((h) => h.target.kind === 'record')).toBe(true)
    expect(searchFile(research(COMPOUND), compound, 'x')).toEqual([])
  })
})
