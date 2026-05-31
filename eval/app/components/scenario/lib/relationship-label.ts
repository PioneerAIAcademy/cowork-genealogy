import type {
  GedcomxPerson,
  GedcomxRelationship,
  GedcomxParentChildRelationship,
  GedcomxCoupleRelationship
} from './schema'
import { getPreferredName, getPrimaryFact } from './schema'

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Treat "Biological" as the implicit/default subtype — don't include it in display strings.
function visibleSubtype(rel: GedcomxParentChildRelationship): string | null {
  return rel.subtype && rel.subtype !== 'Biological' ? rel.subtype.toLowerCase() : null
}

export function parentChildLabel(
  rel: GedcomxParentChildRelationship,
  relativeName: string,
  role: 'parent' | 'child'
): string {
  const subtype = visibleSubtype(rel)
  if (role === 'parent') {
    return subtype
      ? `${capitalize(subtype)} parent of ${relativeName}`
      : `Parent of ${relativeName}`
  }
  return subtype ? `${capitalize(subtype)} child of ${relativeName}` : `Child of ${relativeName}`
}

export function describeRelationship(rel: GedcomxRelationship, persons: GedcomxPerson[]): string {
  const nameOf = (id: string): string => {
    const p = persons.find((x) => x.id === id)
    return p ? getPreferredName(p) : id
  }
  if (rel.type === 'ParentChild') {
    const subtype = visibleSubtype(rel)
    const prefix = subtype ? `${subtype} ` : ''
    return `${nameOf(rel.parent)} → ${prefix}child ${nameOf(rel.child)}`
  }
  return `${nameOf(rel.person1)} ⇔ ${nameOf(rel.person2)}`
}

// ============================================================
// Sidecar persons subview — relationship from primary's perspective
// (used by SidecarResultCard to label each non-primary person)
// ============================================================

type Gender = 'Male' | 'Female' | 'Unknown' | string | undefined

// GedcomX may emit gender as either a short string ("Male") or a URI form
// ("http://gedcomx.org/Male"). Normalize to the short form.
function normalizeGender(gender: Gender): 'Male' | 'Female' | 'Unknown' {
  if (!gender) return 'Unknown'
  const tail = gender.includes('/') ? (gender.split('/').pop() ?? '') : gender
  if (tail === 'Male' || tail === 'Female') return tail
  return 'Unknown'
}

function genderedWord(gender: Gender, male: string, female: string, neutral: string): string {
  const g = normalizeGender(gender)
  if (g === 'Male') return male
  if (g === 'Female') return female
  return neutral
}

function isParentChild(rel: GedcomxRelationship): rel is GedcomxParentChildRelationship {
  return rel.type === 'ParentChild'
}

function isCouple(rel: GedcomxRelationship): rel is GedcomxCoupleRelationship {
  return rel.type === 'Couple'
}

/**
 * Describe `otherId`'s relationship to `primaryId` using the kinship
 * vocabulary the sidecar viewer uses on person cards.
 *
 *   relationshipFromPerspective(primaryId, primaryId, ...) === 'Self'
 *
 * Resolves direct (1-hop) ParentChild + Couple, sibling-by-shared-parent,
 * and 2-hop grandparent/grandchild. Falls back to 'Relative' when present
 * in the payload but unreachable from the primary via these patterns.
 *
 * Gender words use the OTHER person's gender (Father, Wife, Son, ...).
 * Adoptive / step / foster ParentChild subtypes prefix the gendered word
 * (e.g. "Adoptive father").
 */
export function relationshipFromPerspective(
  primaryId: string,
  otherId: string,
  otherGender: Gender,
  relationships: GedcomxRelationship[]
): string {
  if (otherId === primaryId) return 'Self'

  // 1-hop Couple
  for (const rel of relationships.filter(isCouple)) {
    const pair = [rel.person1, rel.person2]
    if (pair.includes(primaryId) && pair.includes(otherId)) {
      return genderedWord(otherGender, 'Husband', 'Wife', 'Spouse')
    }
  }

  const pcRels = relationships.filter(isParentChild)

  // 1-hop ParentChild: other is parent of primary
  for (const rel of pcRels) {
    if (rel.parent === otherId && rel.child === primaryId) {
      const subtype = visibleSubtype(rel)
      const word = genderedWord(otherGender, 'Father', 'Mother', 'Parent')
      return subtype ? `${capitalize(subtype)} ${word.toLowerCase()}` : word
    }
  }

  // 1-hop ParentChild: other is child of primary
  for (const rel of pcRels) {
    if (rel.parent === primaryId && rel.child === otherId) {
      const subtype = visibleSubtype(rel)
      const word = genderedWord(otherGender, 'Son', 'Daughter', 'Child')
      return subtype ? `${capitalize(subtype)} ${word.toLowerCase()}` : word
    }
  }

  // Sibling (shared parent): primary and other both children of same parent
  const primaryParents = new Set(pcRels.filter((r) => r.child === primaryId).map((r) => r.parent))
  if (primaryParents.size > 0) {
    for (const rel of pcRels) {
      if (rel.child === otherId && primaryParents.has(rel.parent)) {
        return genderedWord(otherGender, 'Brother', 'Sister', 'Sibling')
      }
    }
  }

  // 2-hop ParentChild: grandparent (other is parent of primary's parent)
  for (const parentRel of pcRels.filter((r) => r.child === primaryId)) {
    for (const grandRel of pcRels) {
      if (grandRel.child === parentRel.parent && grandRel.parent === otherId) {
        return genderedWord(otherGender, 'Grandfather', 'Grandmother', 'Grandparent')
      }
    }
  }

  // 2-hop ParentChild: grandchild (other is child of primary's child)
  for (const childRel of pcRels.filter((r) => r.parent === primaryId)) {
    for (const grandRel of pcRels) {
      if (grandRel.parent === childRel.child && grandRel.child === otherId) {
        return genderedWord(otherGender, 'Grandson', 'Granddaughter', 'Grandchild')
      }
    }
  }

  return 'Relative'
}

// ============================================================
// Person ordering inside a record-search result
// ============================================================

type Bucket = 'primary' | 'spouse' | 'child' | 'parent' | 'sibling' | 'other'

function bucketFor(label: string): Bucket {
  if (label === 'Self') return 'primary'
  if (label === 'Husband' || label === 'Wife' || label === 'Spouse') return 'spouse'
  if (label === 'Son' || label === 'Daughter' || label === 'Child') return 'child'
  if (
    label === 'Father' ||
    label === 'Mother' ||
    label === 'Parent' ||
    label.endsWith(' father') ||
    label.endsWith(' mother') ||
    label.endsWith(' parent')
  )
    return 'parent'
  if (label === 'Brother' || label === 'Sister' || label === 'Sibling') return 'sibling'
  return 'other'
}

const BUCKET_ORDER: Bucket[] = ['primary', 'spouse', 'child', 'parent', 'sibling', 'other']

function parseBirthYear(person: GedcomxPerson): number | null {
  const birth = getPrimaryFact(person, 'Birth')
  if (!birth?.date) return null
  // Accept "1840", "~1840", "1840-03-12", "Abt 1840"
  const m = birth.date.match(/(\d{4})/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Order a record's persons from the primary's perspective.
 *
 *   PRIMARY -> spouse(s) -> children (eldest first by Birth) -> parents
 *           -> siblings -> other
 *
 * Persons without a discoverable relationship are bucketed as "other"
 * and emitted in payload order. Children with no Birth fact retain
 * payload order (eldest-first is a hint, not a guarantee).
 */
export function orderPersons(
  persons: GedcomxPerson[],
  primaryId: string,
  relationships: GedcomxRelationship[]
): GedcomxPerson[] {
  const buckets: Record<Bucket, GedcomxPerson[]> = {
    primary: [],
    spouse: [],
    child: [],
    parent: [],
    sibling: [],
    other: []
  }

  for (const p of persons) {
    const label = relationshipFromPerspective(primaryId, p.id, p.gender, relationships)
    buckets[bucketFor(label)].push(p)
  }

  // Eldest-first within children. Missing Birth dates sort last,
  // preserving payload order among them.
  buckets.child.sort((a, b) => {
    const ya = parseBirthYear(a)
    const yb = parseBirthYear(b)
    if (ya === null && yb === null) return 0
    if (ya === null) return 1
    if (yb === null) return -1
    return ya - yb
  })

  return BUCKET_ORDER.flatMap((b) => buckets[b])
}
