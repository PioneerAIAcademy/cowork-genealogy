import type { ProofSummary, Question } from '@genealogy/schema'
import { describe, expect, it } from 'vitest'
import type { ResearchDocument } from '../contract'
import { buildRuleIndex } from '../rules/rule-index'
import { COMPOUND, compound } from '../rules/test-data'
import {
  dateWords,
  evidenceGrid,
  factKey,
  overturnRisk,
  reviewerNotes,
  treeColumn,
  whatItChanged,
  whatWasRead
} from './case-model'

const research = () => structuredClone(COMPOUND.research) as unknown as ResearchDocument
const question = (r: ResearchDocument) => r.questions![0] as Question
const proof = (r: ResearchDocument) => r.proof_summaries![0] as ProofSummary

describe('what was read', () => {
  it('a page image is the original page; a persona ARK found by a record search is the index', () => {
    const r = research()
    const page = r.sources!.find((s) => s.id === 'src_001')!
    const index = r.sources!.find((s) => s.id === 'src_002')!
    expect(whatWasRead(r, page)).toBe('original page')
    expect(whatWasRead(r, index)).toBe('index')
  })
})

describe('the evidence grid', () => {
  it('keys a fact type the same however it is written, and gender is sex', () => {
    expect(new Set(['marital_status', 'maritalstatus', 'Marital Status'].map(factKey)).size).toBe(1)
    expect(factKey('gender')).toBe(factKey('sex'))
  })

  it("holds only the proof's supporting assertions, one column per record, oldest first", () => {
    const r = research()
    const grid = evidenceGrid(r, null, compound, question(r), proof(r), null)
    const supporting = new Set(proof(r).supporting_assertion_ids)
    const shown = grid.rows.flatMap((row) => Object.values(row.cells).flat().map((c) => c.assertionId))
    expect(new Set(shown)).toEqual(supporting)
    expect(new Set(grid.columns.map((c) => c.sourceId)).size).toBe(grid.columns.length)
    const years = grid.columns.map((c) => c.year).filter((y): y is number => y !== null)
    expect(years).toEqual([...years].sort((a, b) => a - b))
    expect(grid.hasTree).toBe(false)
  })

  it('a supporting assertion with no live link gets its own row, by its role', () => {
    const r = research()
    const target = proof(r).supporting_assertion_ids[0]
    for (const link of r.person_evidence!) if (link.assertion_id === target) link.superseded_by = 'pe_999'
    const grid = evidenceGrid(r, null, compound, question(r), proof(r), null)
    const role = r.assertions!.find((a) => a.id === target)!.record_role
    expect(grid.rows.some((row) => row.key.startsWith(`role:${role}|`))).toBe(true)
  })

  it("tints only a cell holding a conflict's or an unregistered disagreement's assertion", () => {
    const r = research()
    const grid = evidenceGrid(r, null, compound, question(r), proof(r), null)
    const contested = new Set(r.conflicts!.flatMap((c) => c.competing_assertion_ids))
    const items = grid.rows.flatMap((row) => Object.values(row.cells).flat())
    expect(items.some((i) => i.tinted)).toBe(true)
    for (const item of items) expect(item.tinted).toBe(contested.has(item.assertionId))
  })

  it('the tree column reads the starting tree, with a duplicate parent edge once', () => {
    const tree = {
      persons: [
        { id: 'I1', gender: 'Female', names: [{ given: 'Ann', surname: 'Lee' }], facts: [{ type: 'Birth', date: '1823-12-18', place: 'Alabama' }] },
        { id: 'I2', gender: 'Male', names: [{ given: 'Tom', surname: 'Lee' }] }
      ],
      relationships: [
        { id: 'R1', type: 'ParentChild', parent: 'I2', child: 'I1' },
        { id: 'R2', type: 'ParentChild', parent: 'I2', child: 'I1' },
        { id: 'R3', type: 'Couple', person1: 'I1', person2: 'I2', facts: [{ type: 'Marriage', date: '1840' }] }
      ]
    }
    const column = treeColumn(tree, 'I1')
    expect(column.get('birth')).toEqual(['18 December 1823, Alabama'])
    expect(column.get('sex')).toEqual(['Female'])
    expect(column.get('parentage')).toEqual(['child of Tom Lee'])
    expect(column.get('marriage')).toEqual(['1840'])
  })
})

describe('what the conclusion changed', () => {
  const linked = (r: ResearchDocument) => r.person_evidence!.find((pe) => proof(r).supporting_assertion_ids.includes(pe.assertion_id))!.person_id

  it("keeps only the proof's people, and a marriage dated onto a couple already there", () => {
    const r = research()
    const person = linked(r)
    const changes = {
      personsAdded: ['I99'],
      personsChanged: [{ id: person, addedFacts: [{ type: 'Birth', date: '1823', place: 'Alabama' }] }],
      relationshipsChanged: [{ relationship: { type: 'Couple', person1: person, person2: 'I2' }, addedFacts: [{ type: 'Marriage', date: '1842' }] }]
    }
    const lines = whatItChanged(r, proof(r), changes, compound)!
    expect(lines.some((l) => l.includes('I99') || l.includes('added to the tree'))).toBe(false)
    expect(lines.some((l) => l.startsWith('Birth, 1823, Alabama: added to'))).toBe(true)
    expect(lines.some((l) => l.startsWith('Marriage, 1842: added to'))).toBe(true)
  })

  it('says nothing with no starting tree', () => {
    const r = research()
    expect(whatItChanged(r, proof(r), null, compound)).toBeNull()
  })
})

describe('the reviewer and the leads', () => {
  it("shows the reviewer's narrative alone, else what it said to address", () => {
    expect(reviewerNotes({ narrative_for_user: 'It holds.', must_address: ['x'] })).toEqual({ narrative: 'It holds.', items: [] })
    expect(
      reviewerNotes({
        must_address: [{ standard: 'GPS 3', issue: 'One census is missing.', specific_action: 'Search 1860.', suggested_skill: 'search-records' }],
        consider_addressing: ['Name the informant.']
      })
    ).toEqual({ narrative: null, items: ['One census is missing. Search 1860.', 'Name the informant.'] })
    expect(reviewerNotes(null)).toBeNull()
  })

  it('reads overturn risk as the engine does, trap included', () => {
    expect(overturnRisk('Overturn risk: high — the 1860 schedule could name another child.')).toEqual({
      level: 'high',
      text: 'the 1860 schedule could name another child.'
    })
    expect(overturnRisk('Overturn risk: low. Nothing left.')).toEqual({ level: 'low' })
    expect(overturnRisk('Overturn risk: lowish? no — high')).toBeNull()
    expect(overturnRisk('Every census was read.')).toBeNull()
  })

  it('shows a date one way', () => {
    expect(dateWords('1877-05-12')).toBe('12 May 1877')
    expect(dateWords('abt 1823')).toBe('abt 1823')
  })
})

describe('the index carries the page through', () => {
  it('a fixture index still builds', () => {
    expect(buildRuleIndex({ research: research(), tree: COMPOUND.tree }).persons.size).toBeGreaterThan(0)
  })
})
