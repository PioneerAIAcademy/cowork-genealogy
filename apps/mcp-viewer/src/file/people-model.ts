import { list, strings } from '../cards/kit/view'
import type { ResearchDocument } from '../contract'

type Row = Record<string, unknown>

export interface Family {
  persons: Map<string, Row>
  parents: Map<string, Set<string>>
  children: Map<string, Set<string>>
  spouses: Map<string, Set<string>>
}

function add(map: Map<string, Set<string>>, from: string, to: string): void {
  const set = map.get(from) ?? new Set<string>()
  set.add(to)
  map.set(from, set)
}

/** A tree's people and edges; duplicate edges count once. */
export function familyOf(tree: unknown): Family {
  const t = (tree ?? {}) as { persons?: Row[]; relationships?: Row[] }
  const persons = new Map<string, Row>()
  for (const p of list(t.persons)) if (typeof p?.id === 'string' && p.id) persons.set(p.id, p)
  const family: Family = { persons, parents: new Map(), children: new Map(), spouses: new Map() }
  for (const rel of list(t.relationships)) {
    if (rel?.type === 'ParentChild' && typeof rel.parent === 'string' && typeof rel.child === 'string') {
      add(family.parents, rel.child, rel.parent)
      add(family.children, rel.parent, rel.child)
    }
    if (rel?.type === 'Couple' && typeof rel.person1 === 'string' && typeof rel.person2 === 'string' && rel.person1 !== rel.person2) {
      add(family.spouses, rel.person1, rel.person2)
      add(family.spouses, rel.person2, rel.person1)
    }
  }
  return family
}

/** The ids of a tree's people; null without a tree, so nothing is marked added. */
export function personIds(tree: unknown): Set<string> | null {
  const persons = (tree as { persons?: unknown } | null | undefined)?.persons
  if (!Array.isArray(persons)) return null
  return new Set(persons.map((p) => (p as Row | null)?.id).filter((id): id is string => typeof id === 'string' && id !== ''))
}

/** The research's subject: the first subject id in the tree, else the tree's first person. */
export function subjectOf(research: ResearchDocument, family: Family): string | null {
  for (const id of strings(research.project?.subject_person_ids)) if (family.persons.has(id)) return id
  return family.persons.keys().next().value ?? null
}

function gender(person: Row | undefined): 'male' | 'female' | null {
  const g = typeof person?.gender === 'string' ? person.gender.toLowerCase() : ''
  return g === 'male' || g === 'm' ? 'male' : g === 'female' || g === 'f' ? 'female' : null
}

function word(person: Row | undefined, male: string, female: string, either: string): string {
  const g = gender(person)
  return g === 'male' ? male : g === 'female' ? female : either
}

/** A person's name as the tree holds it: the preferred name, else the first. */
export function treeName(person: Row | undefined): string {
  const names = list(person?.names as Row[] | undefined)
  const name = names.find((n) => n.preferred === true) ?? names[0]
  return [name?.given, name?.surname].filter((p) => typeof p === 'string' && p).join(' ')
}

function has(map: Map<string, Set<string>>, from: string, to: string): boolean {
  return map.get(from)?.has(to) ?? false
}

/** One or two hops from the subject, in words; in-laws, step relations and anything further are null. */
export function relationWord(family: Family, subjectId: string, personId: string): string | null {
  const p = family.persons.get(personId)
  if (has(family.parents, subjectId, personId)) return word(p, 'father', 'mother', 'parent')
  if (has(family.spouses, subjectId, personId)) return word(p, 'husband', 'wife', 'spouse')
  if (has(family.children, subjectId, personId)) return word(p, 'son', 'daughter', 'child')
  const parents = family.parents.get(subjectId) ?? new Set<string>()
  for (const parent of parents) {
    if (has(family.children, parent, personId)) return word(p, 'brother', 'sister', 'sibling')
    if (has(family.parents, parent, personId)) return word(p, 'grandfather', 'grandmother', 'grandparent')
  }
  for (const child of family.children.get(subjectId) ?? []) {
    if (has(family.children, child, personId)) return word(p, 'grandson', 'granddaughter', 'grandchild')
  }
  return null
}

/** "Mary's son", "The subject of this research", or null. */
export function relationTo(family: Family, subjectId: string | null, personId: string): string | null {
  if (!subjectId) return null
  if (personId === subjectId) return 'The subject of this research'
  const rel = relationWord(family, subjectId, personId)
  if (!rel) return null
  const subject = family.persons.get(subjectId)
  const given = list(subject?.names as Row[] | undefined)
  const first = (given.find((n) => n.preferred === true) ?? given[0])?.given
  const name = (typeof first === 'string' && first.trim() ? first.trim().split(/\s+/)[0] : treeName(subject)) || 'The subject'
  return `${name}'s ${rel}`
}

export interface PeopleView {
  subjectId: string
  parents: string[]
  couples: Array<{ spouseId: string; children: string[] }>
  otherChildren: string[]
  everyoneElse: string[]
}

/** The family around the subject, and everyone else in the tree by name. */
export function peopleView(research: ResearchDocument, family: Family): PeopleView | null {
  const subjectId = subjectOf(research, family)
  if (!subjectId) return null
  const byName = (ids: Iterable<string>) => [...ids].filter((id) => family.persons.has(id)).sort((a, b) => treeName(family.persons.get(a)).localeCompare(treeName(family.persons.get(b))))
  const parents = byName(family.parents.get(subjectId) ?? [])
  const children = new Set(family.children.get(subjectId) ?? [])
  const couples = byName(family.spouses.get(subjectId) ?? []).map((spouseId) => {
    const theirs = byName([...children].filter((c) => has(family.parents, c, spouseId)))
    return { spouseId, children: theirs }
  })
  const placed = new Set(couples.flatMap((c) => c.children))
  const otherChildren = byName([...children].filter((c) => !placed.has(c)))
  const shown = new Set([subjectId, ...parents, ...couples.map((c) => c.spouseId), ...children])
  return { subjectId, parents, couples, otherChildren, everyoneElse: byName([...family.persons.keys()].filter((id) => !shown.has(id))) }
}
