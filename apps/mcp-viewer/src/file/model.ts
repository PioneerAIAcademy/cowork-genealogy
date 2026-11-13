import type { Assertion, LogEntry, PersonEvidence, Source } from '@genealogy/schema'
import { statusLabel } from '@genealogy/viewer-ui'
import type { ResearchDocument } from '../contract'
import { isLive, list } from '../cards/kit/view'
import { recordTitle } from '../rules/prose-markdown'
import type { RuleIndex } from '../rules/rule-index'

export const CONFIDENCE_RANK: Record<string, number> = { confident: 3, probable: 2, speculative: 1 }

/** A stored snake_case word as a label: `marital_status` → "Marital status". */
export function labelWords(value: unknown): string {
  if (typeof value !== 'string' || value === '') return ''
  const words = value.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function liveAssertions(research: ResearchDocument, sourceId: string): Assertion[] {
  return list(research.assertions).filter((a) => a.source_id === sourceId && isLive(a))
}

function liveLinks(research: ResearchDocument): PersonEvidence[] {
  return list(research.person_evidence).filter(isLive)
}

/** Each person a source names, with the strongest of their live links through its live assertions. */
export function sourcePeople(research: ResearchDocument, sourceId: string): Array<{ personId: string; confidence: string }> {
  const ids = new Set(liveAssertions(research, sourceId).map((a) => a.id))
  const best = new Map<string, string>()
  for (const link of liveLinks(research)) {
    if (!ids.has(link.assertion_id)) continue
    const now = best.get(link.person_id)
    if (!now || (CONFIDENCE_RANK[link.confidence] ?? 0) > (CONFIDENCE_RANK[now] ?? 0)) best.set(link.person_id, link.confidence)
  }
  return [...best].map(([personId, confidence]) => ({ personId, confidence }))
}

/** The person a live assertion is linked to, at its strongest. */
export function assertionPerson(research: ResearchDocument, assertionId: string): { personId: string; confidence: string } | null {
  let found: { personId: string; confidence: string } | null = null
  for (const link of liveLinks(research)) {
    if (link.assertion_id !== assertionId) continue
    if (!found || (CONFIDENCE_RANK[link.confidence] ?? 0) > (CONFIDENCE_RANK[found.confidence] ?? 0)) {
      found = { personId: link.person_id, confidence: link.confidence }
    }
  }
  return found
}

function performedOf(research: ResearchDocument, source: Source): string {
  const entry = list(research.log).find((e) => e.id === source.log_entry_id)
  return typeof entry?.performed === 'string' ? entry.performed : ''
}

export function sourcesNewestFirst(research: ResearchDocument): Source[] {
  return [...list(research.sources)].sort((a, b) => performedOf(research, b).localeCompare(performedOf(research, a)))
}

/** A source's title: the record it names, else what its citation says it is. */
export function sourceTitle(source: Source, index: RuleIndex): string {
  const fromRecord = recordTitle(index.sources.get(source.id) ?? null)
  if (fromRecord) return fromRecord
  const what = typeof source.citation_detail === 'object' && source.citation_detail ? source.citation_detail.what : null
  return typeof what === 'string' && what.trim() ? what : 'A record'
}

const TOOL_WORDS: Record<string, string> = {
  record_search: 'FamilySearch records',
  fulltext_search: 'Full-text records',
  record_read: 'A record read',
  image_search: 'Page images',
  image_read: 'A page image read',
  image_transcribe: 'A page transcribed',
  volume_search: 'Image volumes',
  external_links_search: 'Other websites’ collections',
  person_read: 'A FamilySearch tree person',
  person_search: 'The FamilySearch tree',
  collections_search: 'FamilySearch collections',
  catalog_search: 'The FamilySearch catalog',
  wiki_search: 'The FamilySearch Wiki',
  wiki_read: 'A FamilySearch Wiki page',
  wikipedia_search: 'Wikipedia'
}

export function toolWords(entry: LogEntry): string {
  if (entry.tool === 'external_site') {
    const site = entry.external_site?.site
    return site ? `Another website: ${statusLabel(site)}` : 'Another website'
  }
  return TOOL_WORDS[entry.tool] ?? labelWords(entry.tool)
}

const NAME_KEYS = ['givenName', 'surname', 'name', 'fatherGivenName', 'fatherSurname', 'motherGivenName', 'motherSurname', 'spouseGivenName', 'spouseSurname']
const PLACE_KEY = /(place|country|subdivision)$/i
const PROSE_KEYS = ['note', 'notes', 'purpose', 'description', 'lookingFor', 'item']

export interface QueryWords {
  /** Plain words: names, places, years, record types, keywords. */
  plain: string[]
  /** Free text the agent wrote, for Prose. */
  prose: string[]
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** A log entry's query in words. A key that holds an id or a setting says nothing. */
export function queryWords(query: unknown, index: RuleIndex): QueryWords {
  const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>
  const plain: string[] = []
  const prose: string[] = []
  const names = NAME_KEYS.map((k) => text(q[k])).filter((v): v is string => v !== null)
  if (names.length > 0) plain.push(names.join(' '))
  for (const [key, value] of Object.entries(q)) {
    if (PLACE_KEY.test(key) && text(value)) plain.push(text(value)!)
  }
  for (const [key, value] of Object.entries(q)) {
    const from = /^(.*)YearFrom$/.exec(key)
    if (!from) continue
    const to = text(q[`${from[1]}YearTo`])
    const start = text(value)
    if (start) plain.push(to && to !== start ? `${start}–${to}` : start)
  }
  if (text(q.yearFrom)) plain.push(text(q.yearTo) && text(q.yearTo) !== text(q.yearFrom) ? `${text(q.yearFrom)}–${text(q.yearTo)}` : text(q.yearFrom)!)
  if (text(q.recordType)) plain.push(statusLabel(text(q.recordType)!))
  if (text(q.keywords)) plain.push(text(q.keywords)!)
  for (const key of ['recordId', 'imageArk', 'ark']) {
    const value = text(q[key])
    if (!value) continue
    const ark = /ark:\/61903\/\d:\d:[A-Z0-9-]+/.exec(value)?.[0]
    const record = ark ? index.records.get(ark) : undefined
    plain.push(record ? recordTitle(record) ?? 'a record' : 'a record')
  }
  if (text(q.subjectId)) {
    const person = index.pidToPerson.get(text(q.subjectId)!) ?? index.persons.get(text(q.subjectId)!)
    plain.push(person?.name ?? 'a person')
  }
  for (const key of PROSE_KEYS) if (text(q[key])) prose.push(text(q[key])!)
  return { plain, prose }
}

export function dateOnly(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

export interface ResultRow {
  label: string
  detail: string[]
  /** An ARK or FamilySearch URL, linked through the display rules. */
  familySearch?: string
  /** An outside collection's own https link, opened as it stands. */
  outside?: string
  /** Agent or OCR text, for Prose. */
  text?: string
}

export interface ResultsView {
  rows: ResultRow[]
  /** Set when the file's tool has a shape this page does not draw. */
  notShown?: number
}

function events(row: Record<string, unknown>): string[] {
  return list(row.events as Array<Record<string, unknown>> | undefined).map((e) =>
    [labelWords(e.type), text(e.date), text(e.place)].filter(Boolean).join(' ')
  )
}

/** One results file's rows, by the tool that wrote it. */
export function resultsView(file: unknown): ResultsView {
  const sidecar = (typeof file === 'object' && file !== null ? file : {}) as Record<string, unknown>
  const payload = (sidecar.payload ?? {}) as Record<string, unknown>
  const raw = payload.results
  const rows = Array.isArray(raw) ? (raw.filter((r) => typeof r === 'object' && r !== null) as Array<Record<string, unknown>>) : []
  switch (sidecar.tool) {
    case 'record_search':
      return {
        rows: rows.map((r) => ({
          label: text(r.personName) ?? 'A person',
          detail: [text(r.recordTitle) ?? text(r.collectionTitle) ?? '', ...events(r)].filter(Boolean),
          familySearch: text(r.recordId) ?? undefined
        }))
      }
    case 'fulltext_search':
      return {
        rows: rows.map((r) => ({
          label: text(r.title) ?? text(r.collectionTitle) ?? 'A document',
          detail: [text(r.recordType), text(r.recordPlace), text(r.recordDate)].filter((v): v is string => v !== null),
          familySearch: text(r.id) ?? undefined,
          text: text(r.textDocument) ?? undefined
        }))
      }
    case 'record_read':
      return {
        rows: rows.map((r) => {
          const persons = list((r.gedcomx as { persons?: Array<Record<string, unknown>> } | undefined)?.persons)
          const principals = persons.filter((p) => p.principal === true)
          const names = (principals.length > 0 ? principals : persons.slice(0, 1)).map((p) => {
            const name = list(p.names as Array<Record<string, unknown>> | undefined)[0]
            return [text(name?.given), text(name?.surname)].filter(Boolean).join(' ')
          })
          return { label: names.filter(Boolean).join(', ') || 'A record', detail: [], familySearch: text(r.recordId) ?? undefined }
        })
      }
    case 'external_links_search':
      return {
        rows: rows.map((r) => {
          const url = text(r.url)
          return { label: text(r.linkText) ?? 'A collection', detail: [], outside: url && /^https:\/\//.test(url) ? url : undefined }
        })
      }
    case 'image_transcribe': {
      const one = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined
      const transcription = text(one?.transcription)
      return { rows: transcription ? [{ label: 'The page, as read', detail: [], text: transcription }] : [] }
    }
    case 'image_search':
      return {
        rows: rows.map((r) => ({ label: 'A page image', detail: [], text: text(r.transcription) ?? undefined }))
      }
    default:
      return { rows: [], notShown: rows.length }
  }
}

export type PageKey = 'sources' | 'log'

export function pagesWithContent(research: ResearchDocument, collections: unknown): PageKey[] {
  const pages: PageKey[] = []
  const places = (collections as { places?: Record<string, unknown> } | null | undefined)?.places
  if (list(research.sources).length > 0 || list(research.localities).length > 0 || (places && Object.keys(places).length > 0)) {
    pages.push('sources')
  }
  if (list(research.log).length > 0) pages.push('log')
  return pages
}

export type PaneTarget = { kind: 'record'; id: string } | { kind: 'search'; id: string } | { kind: 'person'; id: string }

export interface SearchHit {
  target: PaneTarget
  label: string
}

/** The file's search box: records by title and citation, people by name, searches by notes and query. */
export function searchFile(research: ResearchDocument, index: RuleIndex, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  const hits: SearchHit[] = []
  const has = (...values: unknown[]) => values.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
  for (const source of list(research.sources)) {
    const title = sourceTitle(source, index)
    if (has(title, source.citation)) hits.push({ target: { kind: 'record', id: source.id }, label: title })
  }
  for (const person of index.persons.values()) {
    if (person.name && has(person.name)) hits.push({ target: { kind: 'person', id: person.id }, label: person.name })
  }
  for (const entry of list(research.log)) {
    const words = queryWords(entry.query, index)
    if (has(entry.notes, ...words.plain)) {
      hits.push({ target: { kind: 'search', id: entry.id }, label: `${toolWords(entry)}: ${words.plain.join(', ') || dateOnly(entry.performed)}` })
    }
  }
  return hits.slice(0, 20)
}
