import { describe, expect, it } from 'vitest'
import { resolveFieldId } from './field-id'
import { buildRuleIndex } from './rule-index'
import { MCANDREW, mcandrew } from './test-data'

describe('ids in fields', () => {
  it('a tree source is its record', () => {
    expect(resolveFieldId('S26', mcandrew)).toEqual({
      label: 'Michigan, Births, 1867-1902',
      href: 'https://www.familysearch.org/ark:/61903/1:1:NQ8J-TVV'
    })
  })

  it('a person is their name, with their page when they have a pid', () => {
    expect(resolveFieldId('I1', mcandrew)).toEqual({
      label: 'Mary E McAndrew',
      href: 'https://www.familysearch.org/tree/person/details/G13G-P68'
    })
    expect(resolveFieldId('I19', mcandrew)?.label).toBeTruthy()
  })

  it('a question is its text, an assertion its record, a link its person', () => {
    expect(resolveFieldId('q_001', mcandrew)?.label).toMatch(/^What children/)
    expect(resolveFieldId('a_003', mcandrew)?.href).toBe('https://www.familysearch.org/ark:/61903/1:1:NQ8J-TVV')
    const link = (MCANDREW.research.person_evidence as Array<{ id: string; person_id: string }>).find((pe) => pe.id === 'pe_060')
    expect(resolveFieldId('pe_060', mcandrew)?.label).toBe(mcandrew.persons.get(link?.person_id ?? '')?.name)
  })

  it('an unknown or retired id names nothing', () => {
    expect(resolveFieldId('S999', mcandrew)).toBeNull()
    expect(resolveFieldId('log_001', mcandrew)).toBeNull()
    expect(resolveFieldId(42, mcandrew)).toBeNull()
    const research = structuredClone(MCANDREW.research) as Record<string, unknown>
    ;(research.person_evidence as Array<Record<string, unknown>>)[0].superseded_by = 'pe_999'
    expect(resolveFieldId('pe_001', buildRuleIndex({ research, tree: MCANDREW.tree }))).toBeNull()
  })

  it('the tree source for a person page belongs to the sole subject', () => {
    const tree = {
      persons: [{ id: 'I1', names: [{ given: 'Ann', surname: 'Lee' }] }],
      sources: [{ id: 'S1', url: 'https://www.familysearch.org/tree/person/details/KWJ6-RPH' }]
    }
    expect(buildRuleIndex({ research: { project: { subject_person_ids: ['I1'] } }, tree }).pidToPerson.get('KWJ6-RPH')?.id).toBe('I1')
    expect(buildRuleIndex({ research: { project: { subject_person_ids: ['I1', 'I2'] } }, tree }).pidToPerson.get('KWJ6-RPH')).toBeNull()
  })
})
