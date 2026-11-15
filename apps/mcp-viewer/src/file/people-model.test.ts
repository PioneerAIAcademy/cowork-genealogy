import { describe, expect, it } from 'vitest'
import type { ResearchDocument } from '../contract'
import { familyOf, peopleView, personIds, relationTo, subjectOf } from './people-model'

const person = (id: string, given: string, gender?: string) => ({
  id,
  gender,
  names: [{ given, surname: 'Flynn' }]
})

const TREE = {
  persons: [
    person('I1', 'Mary Ann', 'Female'),
    person('I2', 'Patrick', 'Male'),
    person('I3', 'Bridget', 'Female'),
    person('I4', 'John', 'Male'),
    person('I5', 'Kate'),
    person('I6', 'Michael', 'Male'),
    person('I7', 'Thomas', 'Male'),
    person('I8', 'Nora', 'Female'),
    person('I9', 'Owen', 'Male'),
    person('I10', 'Ellen', 'Female')
  ],
  relationships: [
    { type: 'ParentChild', parent: 'I2', child: 'I1' },
    { type: 'ParentChild', parent: 'I2', child: 'I1' },
    { type: 'ParentChild', parent: 'I3', child: 'I1' },
    { type: 'Couple', person1: 'I1', person2: 'I4' },
    { type: 'ParentChild', parent: 'I1', child: 'I5' },
    { type: 'ParentChild', parent: 'I4', child: 'I5' },
    { type: 'ParentChild', parent: 'I1', child: 'I9' },
    { type: 'ParentChild', parent: 'I2', child: 'I6' },
    { type: 'ParentChild', parent: 'I7', child: 'I2' },
    { type: 'ParentChild', parent: 'I5', child: 'I8' },
    { type: 'ParentChild', parent: 'I4', child: 'I10' },
    { type: 'ParentChild', parent: 'I8', child: 'I10' }
  ]
}

const research = (ids?: string[]): ResearchDocument => ({ project: { subject_person_ids: ids } } as ResearchDocument)

describe('the people around the subject', () => {
  const family = familyOf(TREE)

  it('the subject is the first subject id in the tree, else the first person', () => {
    expect(subjectOf(research(['nobody', 'I4']), family)).toBe('I4')
    expect(subjectOf(research(), family)).toBe('I1')
    expect(subjectOf(research(), familyOf({}))).toBeNull()
  })

  it('names each relation by the person, one or two hops, from either gender or none', () => {
    const rel = (id: string) => relationTo(family, 'I1', id)
    expect(rel('I1')).toBe('The subject of this research')
    expect(rel('I2')).toBe("Mary's father")
    expect(rel('I3')).toBe("Mary's mother")
    expect(rel('I4')).toBe("Mary's husband")
    expect(rel('I5')).toBe("Mary's child")
    expect(rel('I9')).toBe("Mary's son")
    expect(rel('I6')).toBe("Mary's brother")
    expect(rel('I7')).toBe("Mary's grandfather")
    expect(rel('I8')).toBe("Mary's granddaughter")
  })

  it('an in-law, a step relation and three hops read null', () => {
    expect(relationTo(family, 'I1', 'I10')).toBeNull()
    expect(relationTo(family, 'I9', 'I4')).toBeNull()
    expect(relationTo(family, 'I8', 'I7')).toBeNull()
  })

  it('draws parents, each couple with its children, other children, then everyone else', () => {
    expect(peopleView(research(['I1']), family)).toEqual({
      subjectId: 'I1',
      parents: ['I3', 'I2'],
      couples: [{ spouseId: 'I4', children: ['I5'] }],
      otherChildren: ['I9'],
      everyoneElse: ['I10', 'I6', 'I8', 'I7']
    })
  })

  it('a duplicate parent edge counts once', () => {
    expect([...(family.parents.get('I1') ?? [])]).toEqual(['I2', 'I3'])
  })

  it('marks nothing added without a starting tree', () => {
    expect(personIds(null)).toBeNull()
    expect(personIds({ persons: [{ id: 'I1' }, {}] })).toEqual(new Set(['I1']))
  })
})
