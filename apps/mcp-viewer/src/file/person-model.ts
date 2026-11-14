import type { Assertion, Timeline } from '@genealogy/schema'
import { isLive, list, strings } from '../cards/kit/view'
import type { ResearchDocument } from '../contract'
import type { RuleIndex } from '../rules/rule-index'
import { dateWords, factKey } from './case-model'
import { readDate } from './compare-read'
import { besideValue, CONFIDENCE_RANK, labelWords, sourcePeople, sourceTitle } from './model'
import { isAbsent } from './record-basis'

type Row = Record<string, unknown>

const FOLD: Record<string, string> = { baptism: 'christening', birthplace: 'birth', birthdate: 'birth' }

export interface LifeRecord {
  sourceId: string
  title: string
  confidence: string | null
}

export interface LifeRow {
  label: string
  text: string
  year: number | null
  records: LifeRecord[]
  /** A linked record's finding that no tree fact holds. */
  fromRecords: boolean
  /** The record was looked at for this and lacked it. */
  absent: boolean
}

function folded(type: unknown): string {
  const key = factKey(type)
  return FOLD[key] ?? key
}

function line(value: unknown, date: unknown, place: unknown): string {
  const v = typeof value === 'string' ? value.trim() : ''
  const rest = besideValue(v, dateWords(date), typeof place === 'string' ? place : '')
  return v ? `${v}${rest}` : rest.replace(/^, /, '')
}

/** A person's life in time order: today's tree facts, each with the records behind it, then what
 *  their linked records say that no tree fact holds. Undated rows last. */
export function lifeOf(research: ResearchDocument, tree: unknown, personId: string, index: RuleIndex): LifeRow[] {
  const t = (tree ?? {}) as { persons?: Row[]; relationships?: Row[] }
  const person = list(t.persons).find((p) => p?.id === personId)
  if (!person) return []
  const assertions = new Map(list(research.assertions).filter(isLive).map((a) => [a.id, a]))
  const sources = new Map(list(research.sources).map((s) => [s.id, s]))
  const byDescription = new Map(list(research.sources).filter((s) => s.gedcomx_source_description_id).map((s) => [String(s.gedcomx_source_description_id), s]))
  const linked = new Map<string, string>()
  for (const pe of list(research.person_evidence)) {
    if (!isLive(pe) || pe.person_id !== personId || !assertions.has(pe.assertion_id)) continue
    const now = linked.get(pe.assertion_id)
    if (!now || (CONFIDENCE_RANK[pe.confidence] ?? 0) > (CONFIDENCE_RANK[now] ?? 0)) linked.set(pe.assertion_id, pe.confidence)
  }
  const strengthVia = (sourceId: string) => sourcePeople(research, sourceId).find((p) => p.personId === personId)?.confidence ?? null
  const recordOf = (sourceId: string): LifeRecord | null => {
    const source = sources.get(sourceId)
    return source ? { sourceId, title: sourceTitle(source, index), confidence: strengthVia(sourceId) } : null
  }
  const used = new Set<string>()
  const yearOf = (date: unknown) => readDate(date)?.from ?? null

  const facts: Row[] = [...list(person.facts as Row[] | undefined)]
  for (const rel of list(t.relationships)) {
    if (rel?.type === 'Couple' && (rel.person1 === personId || rel.person2 === personId)) facts.push(...list(rel.facts as Row[] | undefined))
  }
  const rows: LifeRow[] = facts.map((fact) => {
    const key = folded(fact.type)
    const year = yearOf(fact.standard_date ?? fact.date)
    let behind: Assertion[] = []
    const own = typeof fact.assertion_id === 'string' ? assertions.get(fact.assertion_id) : undefined
    let records: LifeRecord[] = []
    if (own) behind = [own]
    else {
      const refs = list(fact.sources as Row[] | undefined)
        .map((s) => byDescription.get(String(s.ref ?? '').replace(/^#/, '')))
        .filter((s) => s !== undefined)
      if (refs.length > 0) records = refs.map((s) => recordOf(s!.id)).filter((r): r is LifeRecord => r !== null)
      else {
        behind = [...linked.keys()]
          .map((id) => assertions.get(id)!)
          .filter((a) => !isAbsent(a) && folded(a.fact_type) === key && yearOf(a.date) === year)
      }
    }
    for (const a of behind) used.add(a.id)
    if (records.length === 0) {
      const seen = new Set<string>()
      records = behind
        .map((a) => recordOf(a.source_id))
        .filter((r): r is LifeRecord => r !== null && !seen.has(r.sourceId) && (seen.add(r.sourceId), true))
    }
    return { label: labelWords(fact.type), text: line(fact.value, fact.date, fact.place), year, records, fromRecords: false, absent: false }
  })
  for (const [id] of linked) {
    if (used.has(id)) continue
    const a = assertions.get(id)!
    const record = recordOf(a.source_id)
    rows.push({
      label: labelWords(a.fact_type),
      text: line(a.value, a.date, a.place),
      year: yearOf(a.date),
      records: record ? [record] : [],
      fromRecords: true,
      absent: isAbsent(a)
    })
  }
  return rows.sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999))
}

/** The newest timeline that holds this person. */
export function timelineOf(research: ResearchDocument, personId: string): Timeline | null {
  const mine = list(research.timelines).filter((t) => strings(t.person_ids).includes(personId))
  return mine.sort((a, b) => String(b.generated ?? '').localeCompare(String(a.generated ?? '')))[0] ?? null
}
