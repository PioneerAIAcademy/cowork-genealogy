import { describe, it, expect } from 'vitest'
import {
  parentChildLabel,
  describeRelationship,
  relationshipFromPerspective,
  orderPersons
} from '../relationship-label'
import { patrickFlynnGedcomx } from '../__fixtures__/patrick-flynn'
import type {
  GedcomxPerson,
  GedcomxParentChildRelationship,
  GedcomxCoupleRelationship,
  GedcomxRelationship
} from '../schema'

const bio: GedcomxParentChildRelationship = {
  id: 'R1',
  type: 'ParentChild',
  parent: 'I2',
  child: 'I1'
}

const bioExplicit: GedcomxParentChildRelationship = {
  ...bio,
  subtype: 'Biological'
}

const step: GedcomxParentChildRelationship = {
  ...bio,
  subtype: 'Step'
}

const adoptive: GedcomxParentChildRelationship = {
  ...bio,
  subtype: 'Adoptive'
}

describe('parentChildLabel', () => {
  it('omits subtype when absent', () => {
    expect(parentChildLabel(bio, 'Thomas Flynn', 'parent')).toBe('Parent of Thomas Flynn')
    expect(parentChildLabel(bio, 'Patrick Flynn', 'child')).toBe('Child of Patrick Flynn')
  })

  it('omits "Biological" subtype (treated as implicit default)', () => {
    expect(parentChildLabel(bioExplicit, 'Thomas', 'parent')).toBe('Parent of Thomas')
    expect(parentChildLabel(bioExplicit, 'Patrick', 'child')).toBe('Child of Patrick')
  })

  it('renders non-default subtypes with capitalized prefix', () => {
    expect(parentChildLabel(step, 'Bridget Flynn', 'parent')).toBe('Step parent of Bridget Flynn')
    expect(parentChildLabel(adoptive, 'Patrick Flynn', 'child')).toBe(
      'Adoptive child of Patrick Flynn'
    )
  })
})

describe('describeRelationship', () => {
  it('renders a default ParentChild as "parent → child child"', () => {
    expect(describeRelationship(bio, patrickFlynnGedcomx.persons)).toBe(
      'Thomas Flynn → child Patrick Flynn'
    )
  })

  it('includes a non-default subtype between the arrow and "child"', () => {
    const stepBridget: GedcomxParentChildRelationship = {
      id: 'R2',
      type: 'ParentChild',
      parent: 'I3',
      child: 'I1',
      subtype: 'Step'
    }
    expect(describeRelationship(stepBridget, patrickFlynnGedcomx.persons)).toBe(
      'Bridget Flynn → step child Patrick Flynn'
    )
  })

  it('falls back to the id when a person is missing from the array', () => {
    const dangling: GedcomxParentChildRelationship = {
      id: 'R9',
      type: 'ParentChild',
      parent: 'I_UNKNOWN',
      child: 'I1'
    }
    expect(describeRelationship(dangling, patrickFlynnGedcomx.persons)).toBe(
      'I_UNKNOWN → child Patrick Flynn'
    )
  })

  it('renders a Couple as "person1 ⇔ person2"', () => {
    const couple: GedcomxCoupleRelationship = {
      id: 'R3',
      type: 'Couple',
      person1: 'I2',
      person2: 'I3'
    }
    expect(describeRelationship(couple, patrickFlynnGedcomx.persons)).toBe(
      'Thomas Flynn ⇔ Bridget Flynn'
    )
  })
})

// ============================================================
// relationshipFromPerspective
// ============================================================

// Tiny household: Patrick (primary) + Mary (wife) + Thomas (father) +
// Bridget (mother) + Catherine (sister) + James (son) + Bridget Jr (granddaughter)
function household(): {
  persons: GedcomxPerson[]
  relationships: GedcomxRelationship[]
} {
  const persons: GedcomxPerson[] = [
    { id: 'P1', gender: 'Male', names: [{ id: 'n1', given: 'Patrick', surname: 'Flynn' }] },
    { id: 'P2', gender: 'Female', names: [{ id: 'n2', given: 'Mary', surname: 'Flynn' }] },
    { id: 'P3', gender: 'Male', names: [{ id: 'n3', given: 'Thomas', surname: 'Flynn' }] },
    { id: 'P4', gender: 'Female', names: [{ id: 'n4', given: 'Bridget', surname: 'Flynn' }] },
    { id: 'P5', gender: 'Female', names: [{ id: 'n5', given: 'Catherine', surname: 'Flynn' }] },
    { id: 'P6', gender: 'Male', names: [{ id: 'n6', given: 'James', surname: 'Flynn' }] },
    { id: 'P7', gender: 'Female', names: [{ id: 'n7', given: 'Bridget', surname: 'Flynn Jr' }] }
  ]
  const relationships: GedcomxRelationship[] = [
    { id: 'R1', type: 'Couple', person1: 'P1', person2: 'P2' },
    { id: 'R2', type: 'ParentChild', parent: 'P3', child: 'P1' },
    { id: 'R3', type: 'ParentChild', parent: 'P4', child: 'P1' },
    { id: 'R4', type: 'ParentChild', parent: 'P3', child: 'P5' },
    { id: 'R5', type: 'ParentChild', parent: 'P1', child: 'P6' },
    { id: 'R6', type: 'ParentChild', parent: 'P6', child: 'P7' }
  ]
  return { persons, relationships }
}

describe('relationshipFromPerspective', () => {
  const { relationships } = household()

  it('returns Self when other === primary', () => {
    expect(relationshipFromPerspective('P1', 'P1', 'Male', relationships)).toBe('Self')
  })

  it('renders gendered father / mother', () => {
    expect(relationshipFromPerspective('P1', 'P3', 'Male', relationships)).toBe('Father')
    expect(relationshipFromPerspective('P1', 'P4', 'Female', relationships)).toBe('Mother')
  })

  it('renders Parent when gender unknown', () => {
    expect(relationshipFromPerspective('P1', 'P3', 'Unknown', relationships)).toBe('Parent')
    expect(relationshipFromPerspective('P1', 'P3', undefined, relationships)).toBe('Parent')
  })

  it('renders gendered son / daughter', () => {
    expect(relationshipFromPerspective('P1', 'P6', 'Male', relationships)).toBe('Son')
    // P5 is actually Patrick's sister in the household, but we can test
    // the "daughter" path by flipping perspective to Thomas:
    expect(relationshipFromPerspective('P3', 'P5', 'Female', relationships)).toBe('Daughter')
  })

  it('renders gendered husband / wife', () => {
    expect(relationshipFromPerspective('P1', 'P2', 'Female', relationships)).toBe('Wife')
    expect(relationshipFromPerspective('P2', 'P1', 'Male', relationships)).toBe('Husband')
  })

  it('renders Spouse when gender unknown on couple', () => {
    expect(relationshipFromPerspective('P1', 'P2', 'Unknown', relationships)).toBe('Spouse')
  })

  it('renders sibling by shared parent (gendered + neutral)', () => {
    expect(relationshipFromPerspective('P1', 'P5', 'Female', relationships)).toBe('Sister')
    expect(relationshipFromPerspective('P1', 'P5', 'Unknown', relationships)).toBe('Sibling')
  })

  it('renders 2-hop grandparent / grandchild', () => {
    // Patrick's grandparent? Not in the household. But Bridget Jr (P7) is
    // Patrick's grandchild via James (P6).
    expect(relationshipFromPerspective('P1', 'P7', 'Female', relationships)).toBe('Granddaughter')
    expect(relationshipFromPerspective('P7', 'P1', 'Male', relationships)).toBe('Grandfather')
  })

  it('falls back to Relative when unreachable', () => {
    const stranger: GedcomxPerson = {
      id: 'PX',
      gender: 'Male',
      names: [{ id: 'nx', given: 'Stranger', surname: '' }]
    }
    expect(relationshipFromPerspective('P1', stranger.id, stranger.gender, relationships)).toBe(
      'Relative'
    )
  })

  it('prepends adoptive / step subtype on ParentChild', () => {
    const adopRel: GedcomxRelationship = {
      id: 'RA',
      type: 'ParentChild',
      parent: 'PX',
      child: 'P1',
      subtype: 'Adoptive'
    }
    expect(relationshipFromPerspective('P1', 'PX', 'Male', [adopRel])).toBe('Adoptive father')
  })

  it('normalizes GedcomX URI gender forms', () => {
    expect(relationshipFromPerspective('P1', 'P3', 'http://gedcomx.org/Male', relationships)).toBe(
      'Father'
    )
    expect(
      relationshipFromPerspective('P1', 'P4', 'http://gedcomx.org/Female', relationships)
    ).toBe('Mother')
  })
})

// ============================================================
// orderPersons
// ============================================================

describe('orderPersons', () => {
  it('puts the primary first, then spouse, then children, then parents, then siblings', () => {
    const { persons, relationships } = household()
    const ordered = orderPersons(persons, 'P1', relationships)
    const ids = ordered.map((p) => p.id)
    // P1 primary, then P2 (wife/spouse), then P6 (child),
    // then P3+P4 (parents), then P5 (sibling), then P7 (other — grandchild).
    expect(ids.indexOf('P1')).toBe(0)
    expect(ids.indexOf('P2')).toBe(1)
    expect(ids.indexOf('P6')).toBe(2)
    // Parents (P3, P4) come before sibling P5
    expect(ids.indexOf('P3')).toBeLessThan(ids.indexOf('P5'))
    expect(ids.indexOf('P4')).toBeLessThan(ids.indexOf('P5'))
    // Grandchild P7 ends up in "other"
    expect(ids.indexOf('P7')).toBeGreaterThan(ids.indexOf('P5'))
  })

  it('sorts children eldest-first by Birth fact', () => {
    const persons: GedcomxPerson[] = [
      { id: 'PA', gender: 'Male', names: [{ id: 'na', given: 'Dad', surname: '' }] },
      {
        id: 'PB',
        gender: 'Male',
        names: [{ id: 'nb', given: 'Young', surname: '' }],
        facts: [{ id: 'f1', type: 'Birth', primary: true, date: '1880' }]
      },
      {
        id: 'PC',
        gender: 'Female',
        names: [{ id: 'nc', given: 'Eldest', surname: '' }],
        facts: [{ id: 'f2', type: 'Birth', primary: true, date: '1870' }]
      }
    ]
    const relationships: GedcomxRelationship[] = [
      { id: 'r1', type: 'ParentChild', parent: 'PA', child: 'PB' },
      { id: 'r2', type: 'ParentChild', parent: 'PA', child: 'PC' }
    ]
    const ordered = orderPersons(persons, 'PA', relationships)
    expect(ordered.map((p) => p.id)).toEqual(['PA', 'PC', 'PB'])
  })

  it('keeps unrelated persons in the "other" bucket in payload order', () => {
    const persons: GedcomxPerson[] = [
      { id: 'PA', gender: 'Male', names: [{ id: 'na', given: 'Primary', surname: '' }] },
      { id: 'PB', gender: 'Male', names: [{ id: 'nb', given: 'Unrelated1', surname: '' }] },
      { id: 'PC', gender: 'Female', names: [{ id: 'nc', given: 'Unrelated2', surname: '' }] }
    ]
    const ordered = orderPersons(persons, 'PA', [])
    expect(ordered.map((p) => p.id)).toEqual(['PA', 'PB', 'PC'])
  })
})

describe('fixture exercises new schema fields', () => {
  it('attaches an ARK to Patrick (I1)', () => {
    const patrick = patrickFlynnGedcomx.persons.find((p) => p.id === 'I1')
    expect(patrick?.ark).toMatch(/^https:\/\/familysearch\.org\/ark:/)
  })

  it('carries subtype and notes on the Bridget→Patrick relationship', () => {
    const r2 = patrickFlynnGedcomx.relationships.find((r) => r.id === 'R2')
    expect(r2?.type).toBe('ParentChild')
    if (r2?.type === 'ParentChild') {
      expect(r2.subtype).toBe('Step')
      expect(r2.notes).toBeDefined()
      expect(r2.notes?.length).toBeGreaterThan(0)
    }
  })
})
