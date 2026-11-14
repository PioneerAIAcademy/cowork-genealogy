import { describe, expect, it } from 'vitest'
import { buildRuleIndex } from '../rules/rule-index'
import { COMPARE_RESEARCH, STARTING_TREE, TODAY_TREE } from './compare-fixture'
import { compareFindings, type CompareView, type Finding } from './compare-model'

const index = buildRuleIndex({ research: COMPARE_RESEARCH, tree: TODAY_TREE })
const view = compareFindings(COMPARE_RESEARCH, TODAY_TREE, STARTING_TREE, index) as CompareView

function person(id: string) {
  return [...view.people, ...view.possibleRelatives].find((p) => p.personId === id)
}

function rows(id: string, key: string): Finding[] {
  return person(id)?.findings.filter((f) => f.key === key) ?? []
}

describe('Compare with FamilySearch', () => {
  it('is null with no starting tree', () => {
    expect(compareFindings(COMPARE_RESEARCH, TODAY_TREE, null, index)).toBeNull()
    expect(compareFindings(COMPARE_RESEARCH, TODAY_TREE, { persons: 'x' }, index)).toBeNull()
  })

  it('dates the comparison from the project', () => {
    expect(view.asOf).toBe('1 November 2026')
  })

  it('tags each finding against the tree as it stood', () => {
    const births = rows('I1', 'birth')
    // A calculated 1851 against the tree's 1850 says less: Already.
    expect(births.find((f) => f.text.includes('1851'))?.tag).toBe('already')
    // A full date in the tree's year, in a town inside its state: Improved.
    expect(births.find((f) => f.text.includes('4 Apr 1850'))?.tag).toBe('improved')
    // A residence in the tree's year, elsewhere: not a vital event, so New.
    expect(rows('I1', 'residence')[0]?.tag).toBe('new')
    // A death year off the tree's: Differs, on a speculative link, shown and not counted.
    const death = rows('I2', 'death')[0]
    expect(death?.tag).toBe('differs')
    expect(death?.counted).toBe(false)
    expect(rows('I1', 'name').find((f) => f.text === 'Mary Ann Flynn')?.tag).toBe('improved')
    expect(rows('I6', 'name')[0]?.tag).toBe('already')
  })

  it('shows the tree’s value beside each finding', () => {
    expect(rows('I1', 'residence')[0]?.treeValues).toEqual(['1880, St Paul, Ramsey, Minnesota, United States'])
    expect(rows('I1', 'birth').find((f) => f.text.includes('4 Apr 1850'))?.treeValues).toEqual(['1850, Illinois, United States'])
  })

  it('a retired assertion or a retired link is no finding', () => {
    const texts = rows('I1', 'birth').map((f) => f.text)
    expect(texts.some((t) => t.includes('1700'))).toBe(false)
    expect(texts.some((t) => t.includes('1 Jan 1849'))).toBe(false)
  })

  it('a marriage shows under both spouses', () => {
    expect(rows('I1', 'marriage')[0]?.tag).toBe('improved')
    expect(rows('I3', 'marriage')[0]?.tag).toBe('improved')
  })

  it('names the record by its own ARK, even when the source holds a 1:2: url', () => {
    const census = rows('I1', 'residence')[0]?.records[0]
    expect(census?.ark).toBe('ark:/61903/1:1:AAAA-111')
    expect(census?.sourceId).toBe('src_001')
    expect(census?.people.map((p) => p.personId)).toContain('I1')
  })

  it('an added edge between people already in the tree names its record from the source ref', () => {
    const mother = rows('I1', 'relationship').find((f) => f.text === 'Bridget Flynn')
    expect(mother?.label).toBe('Mother')
    expect(mother?.tag).toBe('new')
    expect(mother?.records[0]?.sourceId).toBe('src_002')
    expect(mother?.counted).toBe(true)
    expect(rows('I6', 'relationship').find((f) => f.text === 'Mary Flynn')?.label).toBe('Daughter')
  })

  it('an edge that changed only its subtype is not new', () => {
    expect(rows('I1', 'relationship').some((f) => f.text === 'Patrick Flynn' && f.tag === 'new')).toBe(false)
  })

  it('an edge to an added person shows under both and is not counted', () => {
    const kate = rows('I1', 'relationship').find((f) => f.text === 'Kate Kelly')
    expect(kate?.label).toBe('Daughter')
    expect(kate?.counted).toBe(false)
    expect(rows('I4', 'relationship').map((f) => f.label).sort()).toEqual(['Father', 'Mother'])
  })

  it('lists added people with their strength, and speculative ones as possible relatives', () => {
    expect(person('I4')).toMatchObject({ added: true, strength: 'confident' })
    expect(view.possibleRelatives.map((p) => p.personId)).toEqual(['I5'])
    expect(view.people[0]?.personId).toBe('I1')
  })

  it('counts an added person once, and each person, fact and change once', () => {
    // Mary: a new name piece (ann), another (kelly), a different residence place, a more
    // specific birth date and place (the birthplace assertion repeats the place: once), the
    // marriage's date and place (once for the couple), and the added mother edge.
    expect(view.counts).toEqual({ relatives: 1, facts: 8, peopleWithNew: 3, possibleRelatives: 1 })
  })
})
