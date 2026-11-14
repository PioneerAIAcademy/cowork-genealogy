import type { Assertion, Source } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui/status-label'
import { isLive, list, strings } from '../cards/kit/view'
import type { ResearchDocument } from '../contract'
import type { RuleIndex } from '../rules/rule-index'
import { dateWords, factKey } from './case-model'
import {
  compareDates,
  comparePlaces,
  compareValues,
  nameWords,
  newNamePieces,
  placeParts,
  readDate,
  type ReadDate,
  type Reading
} from './compare-read'
import { besideValue, CONFIDENCE_RANK, labelWords, sourcePeople, sourceTitle } from './model'
import { familyOf, personIds, subjectOf, treeName, type Family } from './people-model'

type Row = Record<string, unknown>

export type Tag = 'already' | 'improved' | 'differs' | 'new'

export interface CompareRecord {
  sourceId: string | null
  title: string
  ark: string | null
  people: Array<{ personId: string; name: string; confidence: string }>
}

export interface Finding {
  /** Stable within one person: what was compared and how it read. */
  id: string
  key: string
  label: string
  text: string
  treeValues: string[]
  tag: Tag
  counted: boolean
  records: CompareRecord[]
}

export interface ComparePerson {
  personId: string
  name: string
  added: boolean
  /** The strongest live link, in words; null when the person has none. */
  strength: string | null
  findings: Finding[]
}

export interface CompareView {
  asOf: string
  people: ComparePerson[]
  possibleRelatives: ComparePerson[]
  counts: { relatives: number; facts: number; peopleWithNew: number; possibleRelatives: number }
}

/** The person facts FamilySearch's tree holds, in the order a person's findings show. */
const COMPARED = ['name', 'sex', 'birth', 'christening', 'marriage', 'residence', 'occupation', 'religion', 'immigration', 'naturalization', 'militaryservice', 'death', 'burial']
const COMPARED_SET = new Set(COMPARED)
const FOLD: Record<string, string> = { baptism: 'christening', birthplace: 'birth', birthdate: 'birth' }
const VITAL = new Set(['birth', 'christening', 'death', 'burial'])
const RECURRING = new Set(['residence', 'occupation', 'religion', 'militaryservice', 'immigration', 'naturalization'])
const VALUE_KEYS = new Set(['occupation', 'religion', 'militaryservice', 'immigration', 'naturalization'])
const TAG_RANK: Record<Tag, number> = { already: 3, improved: 2, differs: 1, new: 0 }

/** A fact the starting tree held for a person. */
export interface StartingFact {
  key: string
  text: string
  date: string | null
  standardDate: string | null
  place: string | null
  standardPlace: string | null
  value: string | null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function factText(value: unknown, date: unknown, place: unknown): string {
  const v = str(value) ?? ''
  const rest = besideValue(v, dateWords(date), str(place) ?? '')
  return v ? `${v}${rest}` : rest.replace(/^, /, '')
}

/** The starting tree's facts for one person: names, sex, their facts, and their couples' facts. Keys unfolded. */
export function startingFacts(startingTree: unknown, personId: string): StartingFact[] {
  const tree = (startingTree ?? {}) as { persons?: Row[]; relationships?: Row[] }
  const person = list(tree.persons).find((p) => p?.id === personId)
  if (!person) return []
  const out: StartingFact[] = []
  const fact = (key: string, f: Row): StartingFact => ({
    key,
    text: factText(f.value, f.date, f.place),
    date: str(f.date),
    standardDate: str(f.standard_date),
    place: str(f.place),
    standardPlace: str(f.standard_place),
    value: str(f.value)
  })
  for (const name of list(person.names as Row[] | undefined)) {
    const text = [name.given, name.surname].filter((p) => typeof p === 'string' && p).join(' ')
    if (text) out.push({ key: 'name', text, date: null, standardDate: null, place: null, standardPlace: null, value: text })
  }
  if (str(person.gender)) {
    out.push({ key: 'sex', text: String(person.gender), date: null, standardDate: null, place: null, standardPlace: null, value: String(person.gender) })
  }
  for (const f of list(person.facts as Row[] | undefined)) out.push(fact(factKey(f.type), f))
  for (const rel of list(tree.relationships)) {
    if (rel?.type !== 'Couple' || (rel.person1 !== personId && rel.person2 !== personId)) continue
    for (const f of list(rel.facts as Row[] | undefined)) out.push(fact(factKey(f.type), f))
  }
  return out
}

function folded(key: string): string {
  return FOLD[key] ?? key
}

function sexOf(value: unknown): string | null {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return null
  return v.startsWith('m') ? 'male' : v.startsWith('f') ? 'female' : v
}

interface Reading3 {
  tag: Tag
  /** The changes the card may count: kind and what changed. */
  changes: string[]
}

function better(a: Reading3, b: Reading3): Reading3 {
  if (TAG_RANK[a.tag] !== TAG_RANK[b.tag]) return TAG_RANK[a.tag] > TAG_RANK[b.tag] ? a : b
  return a.changes.length <= b.changes.length ? a : b
}

function dateSig(d: ReadDate | null): string {
  return d ? `${d.from}-${d.to}/${d.month ?? ''}/${d.day ?? ''}` : ''
}

/** How one finding reads against the starting tree's facts of its key. */
function readFinding(key: string, a: Assertion, facts: StartingFact[]): Reading3 & { pool: StartingFact[] } {
  if (key === 'name') {
    const names = facts.map((f) => f.text)
    if (names.length === 0) return { tag: 'new', changes: nameWords(a.value).length ? [`name:${nameWords(a.value).sort().join(' ')}`] : [], pool: [] }
    const pieces = newNamePieces(a.value, names)
    return pieces.length ? { tag: 'improved', changes: [`name:${pieces.sort().join(' ')}`], pool: facts } : { tag: 'already', changes: [], pool: facts }
  }
  if (key === 'sex') {
    const mine = sexOf(a.value)
    return { tag: facts.some((f) => sexOf(f.value) === mine) ? 'already' : 'new', changes: [], pool: facts }
  }
  const type = String(a.fact_type ?? '').toLowerCase().replace(/[\s_]+/g, '')
  const date = readDate(type === 'birthdate' ? a.value : a.date, a.date_certainty)
  const place = placeParts(type === 'birthplace' ? a.value : (a.standard_place ?? a.place))
  const pool = RECURRING.has(key)
    ? facts.filter((f) => {
        const fd = readDate(f.standardDate ?? f.date)
        return !date || !fd || (fd.from <= date.to && date.from <= fd.to)
      })
    : facts
  if (pool.length === 0) return { tag: 'new', changes: [`new:${date ? date.from : ''}`], pool }
  let best: Reading3 | null = null
  for (const f of pool) {
    const d = compareDates(date, readDate(f.standardDate ?? f.date))
    const p = comparePlaces(place, placeParts(f.standardPlace ?? f.place))
    const v: Reading = VALUE_KEYS.has(key) ? compareValues(a.value, f.value) : 'same'
    const changes: string[] = []
    if (d === 'more') changes.push(`date+:${dateSig(date)}`)
    if (d === 'conflict') changes.push(`date!:${dateSig(date)}`)
    if (p === 'more') changes.push(`place+:${place.join(',')}`)
    if (p === 'conflict') changes.push(`place!:${place.join(',')}`)
    const conflict = d === 'conflict' || p === 'conflict' || v === 'conflict'
    const tag: Tag = conflict ? (VITAL.has(key) ? 'differs' : 'new') : d === 'more' || p === 'more' || v === 'more' ? 'improved' : 'already'
    const reading = { tag, changes: tag === 'already' ? [] : changes }
    best = best ? better(best, reading) : reading
  }
  return { ...best!, pool }
}

function findingText(key: string, a: Assertion): string {
  if (key === 'name' || key === 'sex') return String(a.value ?? '')
  const type = String(a.fact_type ?? '').toLowerCase().replace(/[\s_]+/g, '')
  if (type === 'birthplace') return String(a.value ?? '')
  if (type === 'birthdate') return dateWords(a.value)
  return factText(VALUE_KEYS.has(key) ? a.value : null, a.date, a.place) || String(a.value ?? '')
}

interface Link {
  personId: string
  rank: number
  confidence: string
}

/** Each live assertion's live links, one per person at its strongest. */
function linksByAssertion(research: ResearchDocument): Map<string, Link[]> {
  const out = new Map<string, Map<string, Link>>()
  for (const pe of list(research.person_evidence)) {
    if (!isLive(pe)) continue
    const rank = CONFIDENCE_RANK[pe.confidence] ?? 0
    const byPerson = out.get(pe.assertion_id) ?? new Map<string, Link>()
    const now = byPerson.get(pe.person_id)
    if (!now || rank > now.rank) byPerson.set(pe.person_id, { personId: pe.person_id, rank, confidence: pe.confidence })
    out.set(pe.assertion_id, byPerson)
  }
  return new Map([...out].map(([id, m]) => [id, [...m.values()]]))
}

export function compareFindings(research: ResearchDocument, tree: unknown, startingTree: unknown, index: RuleIndex): CompareView | null {
  const starting = personIds(startingTree)
  if (!starting) return null
  const today = familyOf(tree)
  const before = familyOf(startingTree)
  const sources = new Map(list(research.sources).map((s) => [s.id, s]))
  const name = (id: string) => index.persons.get(id)?.name ?? (treeName(today.persons.get(id)) || 'Someone in the tree')

  const record = (a: Assertion): CompareRecord => {
    const source = sources.get(a.source_id)
    const entry = index.assertions.get(a.id)?.record ?? null
    return {
      sourceId: source ? source.id : null,
      title: source ? sourceTitle(source, index) : (entry?.title ?? 'A record'),
      ark: entry?.ark ?? null,
      people: source ? sourcePeople(research, source.id).map((p) => ({ ...p, name: name(p.personId) })) : []
    }
  }
  const sourceRecord = (source: Source): CompareRecord => {
    const first = list(research.assertions).find((a) => a.source_id === source.id && isLive(a))
    return first ? record(first) : { sourceId: source.id, title: sourceTitle(source, index), ark: null, people: sourcePeople(research, source.id).map((p) => ({ ...p, name: name(p.personId) })) }
  }

  const strongest = new Map<string, Link>()
  const links = linksByAssertion(research)
  for (const list_ of links.values()) {
    for (const link of list_) {
      if (!today.persons.has(link.personId)) continue
      const now = strongest.get(link.personId)
      if (!now || link.rank > now.rank) strongest.set(link.personId, link)
    }
  }
  const isAdded = (id: string) => !starting.has(id)
  const isPossible = (id: string) => isAdded(id) && (strongest.get(id)?.rank ?? 0) < 2

  const rows = new Map<string, Map<string, Finding & { order: number; year: number }>>()
  const counted = new Set<string>()
  const addRow = (personId: string, finding: Finding, order: number, year: number) => {
    const mine = rows.get(personId) ?? new Map()
    const known = mine.get(finding.id)
    if (!known) mine.set(finding.id, { ...finding, order, year })
    else {
      for (const r of finding.records) {
        if (!known.records.some((k: CompareRecord) => k.sourceId === r.sourceId && k.ark === r.ark && k.title === r.title)) known.records.push(r)
      }
      if (finding.text.length > known.text.length) known.text = finding.text
      known.counted = known.counted || finding.counted
    }
    rows.set(personId, mine)
  }

  const live = list(research.assertions).filter(isLive)
  for (const a of live) {
    const key = folded(factKey(a.fact_type))
    if (!COMPARED_SET.has(key)) continue
    const linked = (links.get(a.id) ?? []).filter((l) => today.persons.has(l.personId))
    for (const link of linked) {
      const facts = isAdded(link.personId) ? [] : startingFacts(startingTree, link.personId).filter((f) => folded(f.key) === key)
      const reading = readFinding(key, a, facts)
      const countable = !isAdded(link.personId) && link.rank >= 2 && reading.changes.length > 0
      if (countable) {
        const who = key === 'marriage' ? linked.filter((l) => !isAdded(l.personId)).map((l) => l.personId).sort().join('+') : link.personId
        for (const change of reading.changes) counted.add(`${who}|${key}|${change}`)
      }
      const date = readDate(a.date, a.date_certainty)
      const sig = key === 'name' ? nameWords(a.value).sort().join(' ') : `${dateSig(date)}|${placeParts(a.standard_place ?? a.place).join(',')}|${VALUE_KEYS.has(key) || key === 'sex' ? String(a.value ?? '').toLowerCase() : ''}`
      addRow(
        link.personId,
        {
          id: `${key}|${reading.tag}|${sig}`,
          key,
          label: labelWords(key === 'militaryservice' ? 'military_service' : key),
          text: findingText(key, a),
          treeValues: reading.pool.map((f) => f.text).filter(Boolean),
          tag: reading.tag,
          counted: countable,
          records: [record(a)]
        },
        COMPARED.indexOf(key),
        date?.from ?? 9999
      )
    }
  }

  // Relationships: the ones the research added, and the starting tree's that a record now supports.
  const relWord = (otherId: string, type: string, otherIsParent: boolean): string => {
    const g = String(today.persons.get(otherId)?.gender ?? '').toLowerCase()
    const male = g.startsWith('m')
    const female = g.startsWith('f')
    if (type === 'Couple') return male ? 'Husband' : female ? 'Wife' : 'Spouse'
    if (otherIsParent) return male ? 'Father' : female ? 'Mother' : 'Parent'
    return male ? 'Son' : female ? 'Daughter' : 'Child'
  }
  const bothLinked = (p1: string, p2: string): Assertion[] =>
    live.filter((a) => {
      const ids = (links.get(a.id) ?? []).map((l) => l.personId)
      return ids.includes(p1) && ids.includes(p2)
    })
  const strongBoth = (p1: string, p2: string, a: Assertion) =>
    [p1, p2].every((id) => ((links.get(a.id) ?? []).find((l) => l.personId === id)?.rank ?? 0) >= 2)
  const joined = (family: Family, type: string, a: string, b: string) =>
    type === 'Couple'
      ? (family.spouses.get(a)?.has(b) ?? false)
      : (family.children.get(a)?.has(b) ?? false) || (family.children.get(b)?.has(a) ?? false)
  const edgeRow = (type: string, a: string, b: string, aIsParent: boolean, tag: Tag, records: CompareRecord[], isCounted: boolean) => {
    for (const [me, other, otherIsParent] of [
      [a, b, !aIsParent && type !== 'Couple'],
      [b, a, aIsParent]
    ] as Array<[string, string, boolean]>) {
      if (!today.persons.has(me)) continue
      addRow(
        me,
        {
          id: `edge|${type}|${[a, b].sort().join('+')}|${tag}`,
          key: 'relationship',
          label: relWord(other, type, otherIsParent),
          text: name(other),
          treeValues: tag === 'already' ? [name(other)] : [],
          tag,
          counted: isCounted,
          records
        },
        COMPARED.length,
        9999
      )
    }
  }

  const byDescription = new Map(list(research.sources).filter((s) => s.gedcomx_source_description_id).map((s) => [String(s.gedcomx_source_description_id), s]))
  const seenEdges = new Set<string>()
  for (const rel of list((tree as { relationships?: Row[] } | null)?.relationships)) {
    const type = rel?.type
    const [a, b] = type === 'Couple' ? [rel.person1, rel.person2] : type === 'ParentChild' ? [rel.parent, rel.child] : []
    if (typeof a !== 'string' || typeof b !== 'string' || a === b) continue
    const edge = `${type}|${type === 'Couple' ? [a, b].sort().join('+') : `${a}>${b}`}`
    if (seenEdges.has(edge)) continue
    seenEdges.add(edge)
    const supporting = bothLinked(a, b)
    if (joined(before, String(type), a, b)) {
      // The starting tree had it: shown only when a record now supports it.
      if (supporting.length > 0) edgeRow(String(type), a, b, type === 'ParentChild', 'already', supporting.map(record), false)
      continue
    }
    const fromRefs = list(rel.sources as Row[] | undefined)
      .map((s) => byDescription.get(String(s.ref ?? '').replace(/^#/, '')))
      .filter((s): s is Source => s !== undefined)
    const records = fromRefs.length > 0 ? fromRefs.map(sourceRecord) : supporting.map(record)
    const strong =
      fromRefs.some((s) => {
        const people = sourcePeople(research, s.id)
        return [a, b].every((id) => (CONFIDENCE_RANK[people.find((p) => p.personId === id)?.confidence ?? ''] ?? 0) >= 2)
      }) || supporting.some((s) => strongBoth(a, b, s))
    const isCounted = !isAdded(a) && !isAdded(b) && strong
    if (isCounted) counted.add(`${edge}`)
    edgeRow(String(type), a, b, type === 'ParentChild', 'new', records, isCounted)
  }
  return finish()

  function finish(): CompareView {
    const asOf = dateWords(String(research.project?.created ?? '').slice(0, 10))
    const subjectId = subjectOf(research, today)
    const people: ComparePerson[] = []
    const possible: ComparePerson[] = []
    const ids = new Set([...rows.keys(), ...[...today.persons.keys()].filter(isAdded)])
    for (const id of ids) {
      const findings = [...(rows.get(id)?.values() ?? [])]
        .sort((x, y) => x.order - y.order || x.year - y.year)
        .map(({ order: _o, year: _y, ...f }) => f)
      if (findings.length === 0 && !isAdded(id)) continue
      const link = strongest.get(id)
      const person: ComparePerson = { personId: id, name: name(id), added: isAdded(id), strength: link ? statusLabel(link.confidence) : null, findings }
      ;(isPossible(id) ? possible : people).push(person)
    }
    const byName = (x: ComparePerson, y: ComparePerson) => x.name.localeCompare(y.name)
    people.sort((x, y) => Number(x.added) - Number(y.added) || Number(y.personId === subjectId) - Number(x.personId === subjectId) || byName(x, y))
    possible.sort(byName)
    return {
      asOf,
      people,
      possibleRelatives: possible,
      counts: {
        relatives: people.filter((p) => p.added).length,
        facts: counted.size,
        peopleWithNew: people.filter((p) => !p.added && p.findings.some((f) => f.counted)).length,
        possibleRelatives: possible.length
      }
    }
  }
}
