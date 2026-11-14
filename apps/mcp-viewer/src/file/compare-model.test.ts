import { describe, expect, it } from 'vitest'
import { buildRuleIndex } from '../rules/rule-index'
import { COMPARE_RESEARCH, STARTING_TREE, TODAY_TREE } from './compare-fixture'
import { compareFindings, compareLine, type CompareView, type Finding } from './compare-model'

const index = buildRuleIndex({ research: COMPARE_RESEARCH, tree: TODAY_TREE })
const view = compareFindings(COMPARE_RESEARCH, TODAY_TREE, STARTING_TREE, index) as CompareView

function person(id: string) {
  return [...view.people, ...view.possibleRelatives].find((p) => p.personId === id)
}

function rows(id: string, key: string): Finding[] {
  return person(id)?.findings.filter((f) => f.key === key) ?? []
}

describe("the card's line", () => {
  const line = (relatives: number, facts: number) => compareLine({ relatives, facts, peopleWithNew: 0, possibleRelatives: 0 })

  it('names relatives and facts, each half only when there is one, singular at one', () => {
    expect(line(2, 3)).toBe("This research found 2 new relatives and 3 new facts that aren't on FamilySearch yet")
    expect(line(1, 1)).toBe("This research found 1 new relative and 1 new fact that aren't on FamilySearch yet")
    expect(line(0, 3)).toBe("This research found 3 new facts that aren't on FamilySearch yet")
    expect(line(1, 0)).toBe("This research found 1 new relative that isn't on FamilySearch yet")
    expect(line(0, 1)).toBe("This research found 1 new fact that isn't on FamilySearch yet")
    expect(line(0, 0)).toBeNull()
  })
})

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

  it('a different exact birth date on a likely link is Differs, and counts', () => {
    const birth = rows('I2', 'birth')[0]
    expect(birth?.tag).toBe('differs')
    expect(birth?.counted).toBe(true)
  })

  it('two birthplaces that differ are two rows, not one', () => {
    expect(rows('I3', 'birth').map((f) => f.text).sort()).toEqual(['Iowa, United States', 'Ohio, United States'])
  })

  it("a starting edge a record now supports reads Already in tree", () => {
    const husband = rows('I1', 'relationship').find((f) => f.text === 'John Kelly')
    expect(husband?.tag).toBe('already')
    expect(husband?.label).toBe('Husband')
    expect(husband?.records[0]?.sourceId).toBe('src_002')
  })

  it('a record that lacked a value is no finding, in either spelling, and counts nothing', () => {
    expect(rows('I1', 'occupation')).toEqual([])
    expect(rows('I1', 'immigration')).toEqual([])
  })

  it('a tree fact with no date or place still shows as on FamilySearch', () => {
    expect(rows('I2', 'death')[0]?.treeValues).toEqual(['1890'])
    const bare = compareFindings(
      COMPARE_RESEARCH,
      TODAY_TREE,
      { ...STARTING_TREE, persons: STARTING_TREE.persons.map((p) => (p.id === 'I1' ? { ...p, facts: [{ type: 'Residence' }] } : p)) },
      index
    )
    const residence = bare?.people.find((p) => p.personId === 'I1')?.findings.find((f) => f.key === 'residence')
    expect(residence?.treeValues).toEqual(['with no date or place'])
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
    expect(rows('I4', 'relationship').map((f) => f.label).sort()).toEqual(['Father', 'Husband', 'Mother'])
  })

  it('an edge between two added people shows under both, and is not counted', () => {
    expect(rows('I4', 'relationship').find((f) => f.text === 'Thomas Flynn')).toMatchObject({ label: 'Husband', tag: 'new', counted: false })
    expect(rows('I5', 'relationship').find((f) => f.text === 'Kate Kelly')).toMatchObject({ label: 'Wife', tag: 'new', counted: false })
  })

  it('lists added people with their strength, and speculative ones as possible relatives', () => {
    expect(person('I4')).toMatchObject({ added: true, strength: 'confident' })
    expect(view.possibleRelatives.map((p) => p.personId)).toEqual(['I5'])
    expect(view.people[0]?.personId).toBe('I1')
  })

  it('counts an added person once, and each person, fact and change once', () => {
    // Mary: a new name piece (ann), another (kelly), a different residence place, a more
    // specific birth date and place (the birthplace assertion repeats the place: once), the
    // marriage's date and place (once for the couple), and the added mother edge; Patrick: a
    // different birth date. John's two birthplaces are speculative: shown, not counted.
    expect(view.counts).toEqual({ relatives: 1, facts: 9, peopleWithNew: 4, possibleRelatives: 1 })
  })
})
