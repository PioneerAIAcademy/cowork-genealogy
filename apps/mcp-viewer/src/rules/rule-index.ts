/** What the display rules look up: every id the documents hold, resolved once. */

export const FS_ORIGIN = 'https://www.familysearch.org'

/** A FamilySearch person id, as a tree person's `id` or the tail of its `ark`. */
export const PID_RE = /^[A-Z0-9]{4}(?:-[A-Z0-9]{3,4})+$/
const RECORD_ARK_IN = /ark:\/61903\/(\d:\d:[A-Z0-9]+(?:-[A-Z0-9]+)+)/
const PERSON_PAGE_IN = /\/tree\/person\/(?:details\/)?([A-Z0-9]{4}-[A-Z0-9]{3,4})(?![A-Z0-9-])/

export interface PersonEntry {
  id: string
  name: string | null
  pid: string | null
}

export interface RecordEntry {
  /** `ark:/61903/1:1:XXXX-XXX` */
  ark: string
  title: string
}

export interface RuleIndex {
  persons: Map<string, PersonEntry>
  /** A pid the project knows → its person, or null when the tree names no one. */
  pidToPerson: Map<string, PersonEntry | null>
  /** A full record ARK and its bare id → the record. */
  records: Map<string, RecordEntry>
  /** `S26`, `src_001` → the record it names, or null when it names none. */
  sources: Map<string, RecordEntry | null>
  assertions: Map<string, { record: RecordEntry | null; person: PersonEntry | null }>
  questions: Map<string, string>
  links: Map<string, PersonEntry | null>
}

type Row = Record<string, unknown>

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((v): v is Row => typeof v === 'object' && v !== null) : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function live(row: Row): boolean {
  return row.superseded_by === undefined || row.superseded_by === null
}

/** The `preferred: true` name, else the first; given + surname. */
export function personName(person: Row): string | null {
  const names = rows(person.names)
  const name = names.find((n) => n.preferred === true) ?? names[0]
  if (!name) return null
  const parts = [str(name.given), str(name.surname)].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.map((p) => p.trim()).join(' ') : null
}

/** The `ark:/61903/<n>:<n>:<id>` inside a string, or null. */
export function arkIn(value: unknown): string | null {
  const s = str(value)
  const match = s ? RECORD_ARK_IN.exec(s) : null
  return match ? `ark:/61903/${match[1]}` : null
}

export function bareId(ark: string): string {
  return ark.slice(ark.lastIndexOf(':') + 1)
}

export function isPageImageArk(ark: string): boolean {
  return /^ark:\/61903\/3:\d:/.test(ark)
}

export function buildRuleIndex(documents: { research?: unknown; tree?: unknown }): RuleIndex {
  const research = (typeof documents.research === 'object' && documents.research) || {}
  const tree = (typeof documents.tree === 'object' && documents.tree) || {}
  const r = research as Row
  const t = tree as Row

  const persons = new Map<string, PersonEntry>()
  const pidToPerson = new Map<string, PersonEntry | null>()
  for (const p of rows(t.persons)) {
    const id = str(p.id)
    if (!id) continue
    const arkPid = arkIn(p.ark)
    const pid = PID_RE.test(id) ? id : arkPid && /^ark:\/61903\/4:1:/.test(arkPid) ? bareId(arkPid) : null
    const entry: PersonEntry = { id, name: personName(p), pid }
    persons.set(id, entry)
    if (pid) pidToPerson.set(pid, entry)
  }

  const subjects = Array.isArray((r.project as Row | undefined)?.subject_person_ids)
    ? ((r.project as Row).subject_person_ids as unknown[])
    : []
  const soleSubject = subjects.length === 1 && typeof subjects[0] === 'string' ? persons.get(subjects[0]) ?? null : null

  const treeSources = new Map<string, Row>()
  for (const s of rows(t.sources)) {
    const id = str(s.id)
    if (id) treeSources.set(id, s)
    const page = typeof s.url === 'string' ? PERSON_PAGE_IN.exec(s.url) : null
    if (page && !pidToPerson.has(page[1])) {
      pidToPerson.set(page[1], soleSubject)
    }
  }

  const records = new Map<string, RecordEntry>()
  function addRecord(ark: string | null, title: string | null): RecordEntry | null {
    if (!ark) return null
    const known = records.get(ark)
    if (known) {
      if (known.title === 'this record' && title) known.title = title
      return known
    }
    const entry: RecordEntry = { ark, title: title ?? 'this record' }
    records.set(ark, entry)
    if (!records.has(bareId(ark))) records.set(bareId(ark), entry)
    return entry
  }

  const sources = new Map<string, RecordEntry | null>()
  for (const [id, s] of treeSources) {
    sources.set(id, addRecord(recordArk(s.url), str(s.title)))
  }

  for (const s of rows(r.sources)) {
    const id = str(s.id)
    if (!id) continue
    const sdId = str(s.gedcomx_source_description_id)
    const treeSource = sdId ? treeSources.get(sdId) : undefined
    const detail = s.citation_detail
    const what = typeof detail === 'object' && detail !== null ? str((detail as Row).what) : null
    const title = str(treeSource?.title) ?? what
    sources.set(id, addRecord(recordArk(s.url) ?? recordArk(treeSource?.url), title))
  }

  const links = new Map<string, PersonEntry | null>()
  const linkedPerson = new Map<string, PersonEntry>()
  for (const pe of rows(r.person_evidence)) {
    const id = str(pe.id)
    if (!id || !live(pe)) continue
    const person = persons.get(String(pe.person_id)) ?? null
    links.set(id, person)
    const assertionId = str(pe.assertion_id)
    if (assertionId && person && !linkedPerson.has(assertionId)) linkedPerson.set(assertionId, person)
  }

  const assertions = new Map<string, { record: RecordEntry | null; person: PersonEntry | null }>()
  for (const a of rows(r.assertions)) {
    const id = str(a.id)
    if (!id || !live(a)) continue
    const source = sources.get(String(a.source_id)) ?? null
    const ark = recordArk(a.record_id)
    const record = ark ? addRecord(ark, source?.title ?? null) : source
    assertions.set(id, { record, person: linkedPerson.get(id) ?? null })
  }

  const questions = new Map<string, string>()
  for (const q of rows(r.questions)) {
    const id = str(q.id)
    const text = str(q.question) ?? str(q.text)
    if (id && text) questions.set(id, text)
  }

  return { persons, pidToPerson, records, sources, assertions, questions, links }
}

/** A record ARK (never a person's `4:1:`) inside a string. */
function recordArk(value: unknown): string | null {
  const ark = arkIn(value)
  return ark && !/^ark:\/61903\/4:/.test(ark) ? ark : null
}

export function personHref(pid: string): string {
  return `${FS_ORIGIN}/tree/person/details/${pid}`
}

export function arkHref(ark: string): string {
  return `${FS_ORIGIN}/${ark}`
}
