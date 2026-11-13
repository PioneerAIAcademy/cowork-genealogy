import type { Assertion, Conflict, Hypothesis, NotReachedEntry, PlanItem, ProofSummary, Question, Source } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui'
import { isLive, list, strings } from '../cards/kit/view'
import type { DerivedQuestion, ResearchDocument } from '../contract'
import { isPageImageArk, type RuleIndex } from '../rules/rule-index'
import { assertionPerson, labelWords, sourceTitle } from './model'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** One way to show a date: an ISO date in words, anything else as written. */
export function dateWords(value: unknown): string {
  if (typeof value !== 'string') return ''
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim())
  if (!iso) return value.trim()
  const month = MONTHS[Number(iso[2]) - 1]
  return month ? `${Number(iso[3])} ${month} ${iso[1]}` : value.trim()
}

function yearOf(value: unknown): number | null {
  const match = typeof value === 'string' ? /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(value) : null
  return match ? Number(match[1]) : null
}

/** A fact type as a grid row's key: lower case, no spaces or underscores; gender and sex are one. */
export function factKey(type: unknown): string {
  const key = String(type ?? '').toLowerCase().replace(/[\s_]+/g, '')
  return key === 'gender' ? 'sex' : key
}

const PAGE_TOOLS = new Set(['image_read', 'image_transcribe', 'browser_image_review'])
const INDEX_TOOLS = new Set(['record_search', 'record_read'])

/** What the research read of a source: its original page, its index entry, or neither said. */
export function whatWasRead(research: ResearchDocument, source: Source): 'original page' | 'index' | null {
  const tool = list(research.log).find((e) => e.id === source.log_entry_id)?.tool
  const ark = typeof source.url === 'string' ? /ark:\/61903\/\d:\d:[A-Z0-9-]+/.exec(source.url)?.[0] : undefined
  if (source.image_filename || source.transcription || (ark && isPageImageArk(ark)) || (tool && PAGE_TOOLS.has(tool))) {
    return 'original page'
  }
  if ((ark && /^ark:\/61903\/1:1:/.test(ark)) || (tool && INDEX_TOOLS.has(tool))) return 'index'
  return null
}

export interface GridColumn {
  sourceId: string
  title: string
  informant: string | null
  read: 'original page' | 'index' | null
  year: number | null
}

export interface GridCellItem {
  assertionId: string
  value: string
  date: string
  place: string
  tinted: boolean
}

export interface GridRow {
  key: string
  label: string
  tree: string[] | null
  cells: Record<string, GridCellItem[]>
}

export interface Grid {
  columns: GridColumn[]
  rows: GridRow[]
  hasTree: boolean
}

type TreeLike = { persons?: Array<Record<string, unknown>>; relationships?: Array<Record<string, unknown>> } | null

function nameOf(person: Record<string, unknown> | undefined): string {
  const names = list(person?.names as Array<Record<string, unknown>> | undefined)
  const name = names.find((n) => n.preferred === true) ?? names[0]
  return [name?.given, name?.surname].filter((p) => typeof p === 'string' && p).join(' ')
}

/** What the tree before the research said about one person, by row key. */
export function treeColumn(startingTree: unknown, personId: string): Map<string, string[]> {
  const tree = (startingTree ?? null) as TreeLike
  const out = new Map<string, string[]>()
  const add = (key: string, value: string) => {
    if (!value) return
    const values = out.get(key) ?? []
    if (!values.includes(value)) values.push(value)
    out.set(key, values)
  }
  const persons = list(tree?.persons)
  const person = persons.find((p) => p.id === personId)
  if (!person) return out
  for (const name of list(person.names as Array<Record<string, unknown>> | undefined)) {
    add('name', [name.given, name.surname].filter((p) => typeof p === 'string' && p).join(' '))
  }
  if (typeof person.gender === 'string') add('sex', person.gender)
  for (const fact of list(person.facts as Array<Record<string, unknown>> | undefined)) {
    add(factKey(fact.type), [fact.value, dateWords(fact.date), fact.place].filter((v) => typeof v === 'string' && v).join(', '))
  }
  const byId = new Map(persons.map((p) => [p.id, p]))
  const seen = new Set<string>()
  for (const rel of list(tree?.relationships)) {
    if (rel.type === 'ParentChild') {
      const key = `${rel.parent}>${rel.child}`
      if (seen.has(key)) continue
      seen.add(key)
      if (rel.child === personId) add('parentage', `child of ${nameOf(byId.get(rel.parent))}`)
      if (rel.parent === personId) add('relationship', `parent of ${nameOf(byId.get(rel.child))}`)
    }
    if (rel.type === 'Couple' && (rel.person1 === personId || rel.person2 === personId)) {
      const other = rel.person1 === personId ? rel.person2 : rel.person1
      add('relationship', `spouse of ${nameOf(byId.get(other))}`)
      for (const fact of list(rel.facts as Array<Record<string, unknown>> | undefined)) {
        if (factKey(fact.type) === 'marriage') add('marriage', [dateWords(fact.date), fact.place].filter((v) => typeof v === 'string' && v).join(', '))
      }
    }
  }
  return out
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** The question's assertions for the grid: the proof's supporting ones, else those extracted for it. */
export function gridAssertions(research: ResearchDocument, question: Question | null, proof: ProofSummary | null): Assertion[] {
  const live = list(research.assertions).filter(isLive)
  if (proof) {
    const ids = new Set(strings(proof.supporting_assertion_ids))
    return live.filter((a) => ids.has(a.id))
  }
  if (!question) return []
  return live.filter((a) => strings(a.extracted_for_question_ids).includes(question.id))
}

/** What each record says, side by side: the tree before the research, then each record in date order. */
export function evidenceGrid(
  research: ResearchDocument,
  startingTree: unknown,
  index: RuleIndex,
  question: Question | null,
  proof: ProofSummary | null,
  status: DerivedQuestion | null
): Grid {
  const assertions = gridAssertions(research, question, proof)
  const contested = new Set<string>()
  for (const conflict of list(research.conflicts)) for (const id of strings(conflict.competing_assertion_ids)) contested.add(id)
  for (const d of status?.unregisteredDisagreements ?? []) for (const id of d.assertionIds) contested.add(id)

  const sources = new Map(list(research.sources).map((s) => [s.id, s]))
  const columns = new Map<string, GridColumn>()
  const rows = new Map<string, GridRow>()
  const informants = new Map<string, string[]>()
  const hasTree = startingTree !== null && startingTree !== undefined

  for (const a of assertions) {
    const source = sources.get(a.source_id)
    if (!columns.has(a.source_id)) {
      columns.set(a.source_id, {
        sourceId: a.source_id,
        title: source ? sourceTitle(source, index) : 'A record',
        informant: null,
        read: source ? whatWasRead(research, source) : null,
        year: null
      })
    }
    const column = columns.get(a.source_id)!
    const year = yearOf(a.date)
    if (year !== null && (column.year === null || year < column.year)) column.year = year
    informants.set(a.source_id, [...(informants.get(a.source_id) ?? []), String(a.informant ?? '')])

    const link = assertionPerson(research, a.id)
    const fact = factKey(a.fact_type)
    const rowKey = link ? `${link.personId}|${fact}` : `role:${a.record_role}|${fact}`
    if (!rows.has(rowKey)) {
      const who = link ? (index.persons.get(link.personId)?.name ?? 'Someone') : labelWords(a.record_role)
      const tree = hasTree && link ? (treeColumn(startingTree, link.personId).get(fact) ?? []) : null
      rows.set(rowKey, { key: rowKey, label: `${who}: ${labelWords(a.fact_type).toLowerCase()}`, tree, cells: {} })
    }
    const row = rows.get(rowKey)!
    row.cells[a.source_id] = [
      ...(row.cells[a.source_id] ?? []),
      { assertionId: a.id, value: String(a.value ?? ''), date: dateWords(a.date), place: String(a.place ?? ''), tinted: contested.has(a.id) }
    ]
  }
  for (const [sourceId, values] of informants) {
    const informant = mostCommon(values.filter((v) => v && v !== 'unknown'))
    columns.get(sourceId)!.informant = informant
  }
  const ordered = [...columns.values()].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity))
  return { columns: ordered, rows: [...rows.values()], hasTree }
}

interface TreeChanges {
  personsAdded?: string[]
  personsChanged?: Array<{ id: string; addedFacts?: Array<Record<string, unknown>> }>
  relationshipsAdded?: Array<{ relationship?: Record<string, unknown> }>
  relationshipsChanged?: Array<{ relationship?: Record<string, unknown>; addedFacts?: Array<Record<string, unknown>> }>
}

function factLine(fact: Record<string, unknown>): string {
  return [labelWords(fact.type), dateWords(fact.date), fact.place].filter((v) => typeof v === 'string' && v).join(', ')
}

/** What the conclusion put in the tree, kept to the people the proof's evidence is linked to. */
export function whatItChanged(research: ResearchDocument, proof: ProofSummary | null, treeChanges: unknown, index: RuleIndex): string[] | null {
  if (!treeChanges || typeof treeChanges !== 'object') return null
  if (!proof) return []
  const changes = treeChanges as TreeChanges
  const supporting = new Set(strings(proof.supporting_assertion_ids))
  const people = new Set(
    list(research.person_evidence)
      .filter((pe) => isLive(pe) && supporting.has(pe.assertion_id))
      .map((pe) => pe.person_id)
  )
  const name = (id: unknown) => index.persons.get(String(id))?.name ?? 'someone'
  const lines: string[] = []
  for (const id of changes.personsAdded ?? []) if (people.has(id)) lines.push(`${name(id)} added to the tree.`)
  for (const delta of changes.personsChanged ?? []) {
    if (!people.has(delta.id)) continue
    for (const fact of delta.addedFacts ?? []) lines.push(`${factLine(fact)}: added to ${name(delta.id)}.`)
  }
  const pair = (rel: Record<string, unknown> | undefined) =>
    rel?.type === 'Couple' ? [rel.person1, rel.person2] : rel?.type === 'ParentChild' ? [rel.parent, rel.child] : []
  for (const delta of changes.relationshipsAdded ?? []) {
    const [a, b] = pair(delta.relationship)
    if (!people.has(String(a)) && !people.has(String(b))) continue
    lines.push(
      delta.relationship?.type === 'Couple'
        ? `${name(a)} and ${name(b)} added as a couple.`
        : `${name(a)} added as a parent of ${name(b)}.`
    )
  }
  for (const delta of changes.relationshipsChanged ?? []) {
    const [a, b] = pair(delta.relationship)
    if (!people.has(String(a)) && !people.has(String(b))) continue
    for (const fact of delta.addedFacts ?? []) lines.push(`${factLine(fact)}: added to ${name(a)} and ${name(b)}.`)
  }
  return lines
}

export interface ReviewerNotes {
  narrative: string | null
  items: string[]
}

function noteText(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null
  if (typeof item !== 'object' || item === null) return null
  const { issue, specific_action: action } = item as { issue?: unknown; specific_action?: unknown }
  const parts = [issue, action].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return parts.length > 0 ? parts.join(' ') : null
}

/** The reviewer's words: its narrative, or, with none, what it said to address. */
export function reviewerNotes(body: unknown): ReviewerNotes | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const narrative = typeof b.narrative_for_user === 'string' && b.narrative_for_user.trim() ? b.narrative_for_user : null
  if (narrative) return { narrative, items: [] }
  const items = [...(Array.isArray(b.must_address) ? b.must_address : []), ...(Array.isArray(b.consider_addressing) ? b.consider_addressing : [])]
    .map(noteText)
    .filter((t): t is string => t !== null)
  return { narrative: null, items }
}

export type Overturn = { level: 'high'; text: string } | { level: 'low' } | null

/** A recorded overturn risk, read as the engine reads it. */
export function overturnRisk(justification: unknown): Overturn {
  if (typeof justification !== 'string') return null
  const match = /^\s*overturn risk:\s*(high|low)\b(.*)$/is.exec(justification)
  if (!match) return null
  if (match[1].toLowerCase() === 'low') return { level: 'low' }
  return { level: 'high', text: match[2].replace(/^\s*[-–—:.,;]\s*/, '').trim() }
}

const LEAD_KINDS: Record<string, string> = {
  nil_search: 'Searched, nothing found',
  browse_only: 'Images only, not indexed',
  over_transport_cap: 'Too large to read here',
  paywalled: 'Behind a paywall',
  handed_to_user: 'Handed to the researcher',
  privacy_sealed: 'Closed for privacy',
  skipped_plan_item: 'A planned search not run',
  wiki_named_untouched: 'Named by the FamilySearch Wiki, not searched',
  deferred: 'Left for later'
}

export function leadKindWords(kind: unknown): string {
  return typeof kind === 'string' ? (LEAD_KINDS[kind] ?? statusLabel(kind)) : 'A lead'
}

export function needsResearcher(kind: unknown): boolean {
  return kind === 'handed_to_user' || kind === 'paywalled'
}

export function leadsOf(question: Question | null): NotReachedEntry[] {
  return list(question?.search_stop?.not_reached)
}

export function conflictsOf(research: ResearchDocument, question: Question): Conflict[] {
  const own = new Set(list(research.assertions).filter((a) => strings(a.extracted_for_question_ids).includes(question.id)).map((a) => a.id))
  return list(research.conflicts).filter(
    (c) =>
      strings(c.blocks_question_ids).includes(question.id) ||
      strings(c.competing_assertion_ids).some((id) => own.has(id))
  )
}

export function hypothesesOf(research: ResearchDocument, question: Question): Hypothesis[] {
  return list(research.hypotheses).filter((h) => strings(h.related_question_ids).includes(question.id))
}

export function planItemsOf(research: ResearchDocument, question: Question): PlanItem[] {
  return list(research.plans)
    .filter((p) => p.question_id === question.id)
    .flatMap((p) => list(p.items as unknown as PlanItem[]))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

const STOP_CRITERIA_WORDS: Record<string, string> = {
  goal_alignment: 'Fits the goal',
  repository_breadth: 'Where it looked',
  original_substitution: 'Originals over indexes',
  independent_verification: 'Independent sources',
  evidence_class: 'Kind of evidence',
  conflict_resolution: 'Conflicts',
  overturn_risk: 'Could anything change the answer'
}

export function stopCriteria(question: Question | null): Array<{ label: string; text: string }> {
  const criteria = question?.search_stop?.stop_criteria as Record<string, unknown> | null | undefined
  if (!criteria || typeof criteria !== 'object') return []
  return Object.entries(criteria)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => ({ label: STOP_CRITERIA_WORDS[k] ?? labelWords(k), text: v as string }))
}
