import type {
  ResearchData,
  GedcomxData,
  GedcomxPerson,
  GedcomxFact,
  GedcomxName,
  GedcomxSourceRef,
  GedcomxSource,
  GedcomxCoupleRelationship,
  GedcomxParentChildRelationship,
  Assertion,
  PersonEvidence,
  Source
} from './schema'
import { treeOnlySources } from './tree-sources'
import { resolveFamilySearchTarget } from './familysearch-url'

// GEDCOM 5.5.1 export of a project's research tree. The mapping contract is
// docs/specs/gedcom-export-spec.md; section numbers below refer to it.

const MAX_LINE = 255
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// ---------------------------------------------------------------------------
// §3 Encoding
// ---------------------------------------------------------------------------

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** Split one logical line of text into CONC chunks, each escaped (`@` → `@@`)
 *  and no longer than its budget. A split point is never next to a space and
 *  never between the halves of a surrogate pair. */
function concChunks(text: string, firstBudget: number, restBudget: number): string[] {
  const out: string[] = []
  let i = 0
  let budget = firstBudget
  do {
    let j = i
    let len = 0
    while (j < text.length) {
      const w = text[j] === '@' ? 2 : 1
      if (len + w > budget) break
      len += w
      j++
    }
    if (j < text.length) {
      let k = j
      while (
        k > i + 1 &&
        (text[k - 1] === ' ' || text[k] === ' ' || isHighSurrogate(text.charCodeAt(k - 1)))
      ) {
        k--
      }
      if (k > i + 1) j = k
      else if (isHighSurrogate(text.charCodeAt(j - 1)) && j - 1 > i) j--
    }
    out.push(text.slice(i, j).replace(/@/g, '@@'))
    i = j
    budget = restBudget
  } while (i < text.length)
  return out
}

class GedcomWriter {
  readonly lines: string[] = []

  /** A line whose value is text: escaped, split on newlines into CONT and
   *  wrapped with CONC. */
  text(level: number, tag: string, value?: string | null, xref?: string): void {
    const head = `${level} ${xref ? `${xref} ` : ''}${tag}`
    if (value === undefined || value === null || value === '') {
      this.lines.push(head)
      return
    }
    const sub = level + 1
    value.split(/\r\n|\r|\n/).forEach((segment, idx) => {
      const prefix = idx === 0 ? head : `${sub} CONT`
      if (segment === '') {
        this.lines.push(prefix)
        return
      }
      const chunks = concChunks(
        segment,
        MAX_LINE - prefix.length - 1,
        MAX_LINE - `${sub} CONC `.length
      )
      chunks.forEach((chunk, c) => {
        this.lines.push(c === 0 ? `${prefix} ${chunk}` : `${sub} CONC ${chunk}`)
      })
    })
  }

  /** A line whose value is a cross-reference pointer (never escaped). */
  pointer(level: number, tag: string, xref: string): void {
    this.lines.push(`${level} ${tag} ${xref}`)
  }

  toString(): string {
    return this.lines.join('\n') + '\n'
  }
}

// ---------------------------------------------------------------------------
// §4.2 Dates
// ---------------------------------------------------------------------------

const DATE_ATOM = `(?:(?:\\d{1,2} )?(?:${MONTHS.join('|')}) )?\\d{3,4}(?:/\\d{2})?`
const GEDCOM_DATE = new RegExp(
  `^(?:(?:ABT|CAL|EST|BEF|AFT) ${DATE_ATOM}` +
    `|BET ${DATE_ATOM} AND ${DATE_ATOM}` +
    `|FROM ${DATE_ATOM}(?: TO ${DATE_ATOM})?` +
    `|TO ${DATE_ATOM}` +
    `|${DATE_ATOM})$`
)

/** English month spellings → the GEDCOM three-letter month. */
const MONTH_WORDS: Record<string, string> = Object.fromEntries(
  [
    'JANUARY',
    'FEBRUARY',
    'MARCH',
    'APRIL',
    'MAY',
    'JUNE',
    'JULY',
    'AUGUST',
    'SEPTEMBER',
    'OCTOBER',
    'NOVEMBER',
    'DECEMBER'
  ].flatMap((full, i) => [
    [full, MONTHS[i]],
    [MONTHS[i], MONTHS[i]]
  ])
)
MONTH_WORDS.SEPT = 'SEP'

/** A raw `date` rewritten toward GEDCOM form: `~` → `ABT`, ISO → `D MON YYYY`,
 *  month names → three-letter months, `Mon D, YYYY` → `D MON YYYY`. The result
 *  is still checked against the grammar; this only widens what passes. */
function normalizeRawDate(date: string): string {
  let s = date.trim().replace(/\s+/g, ' ')
  let prefix = ''
  if (s.startsWith('~')) {
    prefix = 'ABT '
    s = s.slice(1).trim()
  }
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s)
  if (iso) {
    const month = MONTHS[Number(iso[2]) - 1]
    if (month) s = iso[3] ? `${Number(iso[3])} ${month} ${iso[1]}` : `${month} ${iso[1]}`
    return prefix + s
  }
  s = s.replace(/[A-Za-z]+\.?/g, (word) => MONTH_WORDS[word.replace('.', '').toUpperCase()] ?? word)
  const monthFirst = /^([A-Z]{3}) (\d{1,2}),? (\d{3,4})$/.exec(s)
  if (monthFirst && MONTHS.includes(monthFirst[1])) {
    s = `${Number(monthFirst[2])} ${monthFirst[1]} ${monthFirst[3]}`
  }
  return prefix + s
}

/** The DATE value for a fact, or null when it has no date at all. */
export function gedcomDate(fact: Pick<GedcomxFact, 'date' | 'standard_date'>): string | null {
  const original = fact.standard_date?.trim() || fact.date?.trim()
  if (!original) return null
  const candidate = (
    fact.standard_date?.trim() ? fact.standard_date.trim() : normalizeRawDate(original)
  )
    .replace(/\s+/g, ' ')
    .toUpperCase()
  return GEDCOM_DATE.test(candidate) ? candidate : `(${original})`
}

function headerDate(now: Date): string {
  return `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`
}

// ---------------------------------------------------------------------------
// §4.1 / §5 Fact tags
// ---------------------------------------------------------------------------

/** Event tags take no value on the line; a fact value goes in a NOTE. */
const PERSON_EVENT_TAGS: Record<string, string> = {
  Birth: 'BIRT',
  Death: 'DEAT',
  Burial: 'BURI',
  Christening: 'CHR',
  Baptism: 'BAPM',
  Blessing: 'BLES',
  Residence: 'RESI',
  Census: 'CENS',
  Immigration: 'IMMI',
  Emigration: 'EMIG',
  Naturalization: 'NATU',
  Will: 'WILL',
  Probate: 'PROB'
}

/** Attribute tags carry the fact value on the line. */
const PERSON_ATTRIBUTE_TAGS: Record<string, string> = {
  Occupation: 'OCCU',
  Education: 'EDUC',
  Religion: 'RELI',
  Property: 'PROP'
}

const COUPLE_EVENT_TAGS: Record<string, string> = {
  Marriage: 'MARR',
  Divorce: 'DIV',
  Annulment: 'ANUL',
  Engagement: 'ENGA',
  MarriageBanns: 'MARB'
}

const SKIPPED_PERSON_FACTS = new Set(['Parents'])

// ---------------------------------------------------------------------------
// §8 Source references
// ---------------------------------------------------------------------------

/** Append to the list at `key`, creating it on first use. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

interface ResearchSourceEntry {
  xref: string
  source: Source
  tree?: GedcomxSource
}

interface SourceIndex {
  byResearchId: Map<string, ResearchSourceEntry>
  /** tree source id → every xref it resolves to */
  byTreeRef: Map<string, string[]>
  research: ResearchSourceEntry[]
  treeOnly: { xref: string; source: GedcomxSource }[]
}

function sourceIndex(research: ResearchData, gedcomx: GedcomxData): SourceIndex {
  const treeById = new Map((gedcomx.sources ?? []).map((s) => [s.id, s]))
  const byResearchId = new Map<string, ResearchSourceEntry>()
  const byTreeRef = new Map<string, string[]>()
  const researchEntries: ResearchSourceEntry[] = []
  const treeOnlyEntries: SourceIndex['treeOnly'] = []
  let n = 0

  for (const source of research.sources ?? []) {
    const treeId = source.gedcomx_source_description_id
    const entry = { xref: `@S${++n}@`, source, tree: treeById.get(treeId) }
    byResearchId.set(source.id, entry)
    if (treeId) pushTo(byTreeRef, treeId, entry.xref)
    researchEntries.push(entry)
  }
  for (const source of treeOnlySources(research, gedcomx)) {
    const xref = `@S${++n}@`
    byTreeRef.set(source.id, [xref])
    treeOnlyEntries.push({ xref, source })
  }
  return { byResearchId, byTreeRef, research: researchEntries, treeOnly: treeOnlyEntries }
}

/** `skip`: xrefs already cited at this level with fuller detail (§4.3). */
function writeSourceRefs(
  w: GedcomWriter,
  level: number,
  refs: GedcomxSourceRef[] | undefined,
  index: SourceIndex,
  skip?: Set<string>
): void {
  for (const ref of refs ?? []) {
    for (const xref of index.byTreeRef.get(ref.ref) ?? []) {
      if (skip?.has(xref)) continue
      w.pointer(level, 'SOUR', xref)
      if (ref.page) w.text(level + 1, 'PAGE', ref.page)
      if (typeof ref.quality === 'number') w.text(level + 1, 'QUAY', String(ref.quality))
    }
  }
}

// ---------------------------------------------------------------------------
// §5 Families
// ---------------------------------------------------------------------------

interface FamilyChild {
  childId: string
  edges: GedcomxParentChildRelationship[]
}

interface Family {
  xref: string
  parentIds: string[]
  couples: GedcomxCoupleRelationship[]
  children: FamilyChild[]
}

function familyKey(parentIds: string[]): string {
  return [...parentIds].sort().join('|')
}

export function buildFamilies(gedcomx: GedcomxData): Family[] {
  const personIds = new Set((gedcomx.persons ?? []).map((p) => p.id))
  const byKey = new Map<string, Family>()
  const families: Family[] = []

  const familyFor = (parentIds: string[]): Family => {
    const key = familyKey(parentIds)
    let fam = byKey.get(key)
    if (!fam) {
      fam = { xref: `@F${families.length + 1}@`, parentIds, couples: [], children: [] }
      byKey.set(key, fam)
      families.push(fam)
    }
    return fam
  }

  const relationships = gedcomx.relationships ?? []
  for (const rel of relationships) {
    if (rel.type !== 'Couple') continue
    if (!personIds.has(rel.person1) || !personIds.has(rel.person2)) continue
    if (rel.person1 === rel.person2) continue
    familyFor([rel.person1, rel.person2]).couples.push(rel)
  }

  const edgesByChild = new Map<string, GedcomxParentChildRelationship[]>()
  for (const rel of relationships) {
    if (rel.type !== 'ParentChild') continue
    if (!personIds.has(rel.parent) || !personIds.has(rel.child)) continue
    pushTo(edgesByChild, rel.child, rel)
  }

  for (const [childId, edges] of edgesByChild) {
    const parents = [...new Set(edges.map((e) => e.parent))]
    const used = new Set<string>()
    const groups: string[][] = []
    for (let a = 0; a < parents.length; a++) {
      for (let b = a + 1; b < parents.length; b++) {
        const [pa, pb] = [parents[a], parents[b]]
        if (used.has(pa) || used.has(pb)) continue
        const fam = byKey.get(familyKey([pa, pb]))
        if (fam && fam.couples.length > 0) {
          groups.push([pa, pb])
          used.add(pa)
          used.add(pb)
        }
      }
    }
    const leftovers = parents.filter((p) => !used.has(p))
    if (leftovers.length === 2) groups.push(leftovers)
    else for (const p of leftovers) groups.push([p])

    for (const group of groups) {
      const fam = familyFor(group)
      if (fam.children.some((c) => c.childId === childId)) continue
      fam.children.push({ childId, edges: edges.filter((e) => group.includes(e.parent)) })
    }
  }
  return families
}

function husbandAndWife(
  parentIds: string[],
  sexOf: (id: string) => GedcomxPerson['gender'] | undefined
): { husb?: string; wife?: string } {
  if (parentIds.length === 1) {
    return sexOf(parentIds[0]) === 'Female' ? { wife: parentIds[0] } : { husb: parentIds[0] }
  }
  const [a, b] = parentIds
  const swap =
    (sexOf(a) !== 'Male' && sexOf(b) === 'Male') ||
    (sexOf(a) === 'Female' && sexOf(b) !== 'Female')
  return swap ? { husb: b, wife: a } : { husb: a, wife: b }
}

const PEDIGREE: Record<string, string> = {
  Biological: 'birth',
  Adoptive: 'adopted',
  Foster: 'foster'
}

// ---------------------------------------------------------------------------
// §4 Individuals
// ---------------------------------------------------------------------------

const NAME_TYPES: Record<string, string> = {
  BirthName: 'birth',
  MarriedName: 'married',
  AlsoKnownAs: 'aka'
}

function writeName(w: GedcomWriter, name: GedcomxName, index: SourceIndex): void {
  const given = (name.given ?? '').trim()
  const surname = (name.surname ?? '').trim()
  w.text(1, 'NAME', `${given} /${surname}/`.trim())
  if (name.prefix) w.text(2, 'NPFX', name.prefix)
  if (given) w.text(2, 'GIVN', given)
  if (surname) w.text(2, 'SURN', surname)
  if (name.suffix) w.text(2, 'NSFX', name.suffix)
  if (name.type === 'Nickname' && given) w.text(2, 'NICK', given)
  else if (name.type && NAME_TYPES[name.type]) w.text(2, 'TYPE', NAME_TYPES[name.type])
  writeSourceRefs(w, 2, name.sources, index)
}

function writeFactDetail(w: GedcomWriter, fact: GedcomxFact, index: SourceIndex): void {
  const date = gedcomDate(fact)
  if (date) w.text(2, 'DATE', date)
  const place = fact.standard_place || fact.place
  if (place) w.text(2, 'PLAC', place)
  writeSourceRefs(w, 2, fact.sources, index)
}

function writePersonFact(w: GedcomWriter, fact: GedcomxFact, index: SourceIndex): void {
  if (SKIPPED_PERSON_FACTS.has(fact.type)) return
  const attribute = PERSON_ATTRIBUTE_TAGS[fact.type]
  const event = PERSON_EVENT_TAGS[fact.type]
  if (attribute) {
    w.text(1, attribute, fact.value)
  } else if (event) {
    w.text(1, event)
    if (fact.value) w.text(2, 'NOTE', fact.value)
  } else {
    w.text(1, 'EVEN', fact.value)
    w.text(2, 'TYPE', fact.type)
  }
  writeFactDetail(w, fact, index)
}

function writeCoupleFact(w: GedcomWriter, fact: GedcomxFact, index: SourceIndex): void {
  const event = COUPLE_EVENT_TAGS[fact.type]
  if (event) {
    w.text(1, event)
    if (fact.value) w.text(2, 'NOTE', fact.value)
  } else {
    w.text(1, 'EVEN', fact.value)
    w.text(2, 'TYPE', fact.type)
  }
  writeFactDetail(w, fact, index)
}

/** The tree PID and canonical URL for a person's `ark`, in any of the shapes
 *  project data carries (bare ARK, resolver URL, bare `4:1:` id, `/tree/person/`
 *  URL); null for anything that is not a FamilySearch tree person. */
function familySearchTreeLink(ark: string | undefined): { pid: string; url: string } | null {
  const url = resolveFamilySearchTarget(ark)
  if (!url) return null
  const match = /(?:\/4:1:|\/tree\/person\/)([A-Za-z0-9-]+)$/.exec(url)
  return match ? { pid: match[1], url } : null
}

function assertionLine(a: Assertion, pe: PersonEvidence): string {
  const where = [a.value, a.date, a.place].filter((x) => x && String(x).trim()).join(', ')
  return `${a.fact_type}: ${where} — ${pe.confidence}: ${pe.rationale}`
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** `<project title>.ged`, with characters no file system accepts removed. */
export function gedcomFileName(research: ResearchData | null | undefined): string {
  const raw = research?.project?.title?.trim() || research?.project?.id || ''
  // eslint-disable-next-line no-control-regex
  const safe = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
  return `${safe || 'research'}.ged`
}

export function exportGedcom(
  research: ResearchData,
  gedcomx: GedcomxData,
  opts: { now?: Date } = {}
): string {
  const w = new GedcomWriter()
  const persons = gedcomx.persons ?? []
  const personById = new Map(persons.map((p) => [p.id, p]))
  const sexOf = (id: string): GedcomxPerson['gender'] | undefined => personById.get(id)?.gender
  const index = sourceIndex(research, gedcomx)
  const families = buildFamilies(gedcomx)
  const indiXref = new Map(persons.map((p, i) => [p.id, `@I${i + 1}@`]))

  const famsOf = new Map<string, string[]>()
  const famcOf = new Map<string, { fam: Family; child: FamilyChild }[]>()
  for (const fam of families) {
    for (const parent of fam.parentIds) pushTo(famsOf, parent, fam.xref)
    for (const child of fam.children) pushTo(famcOf, child.childId, { fam, child })
  }

  const assertionById = new Map((research.assertions ?? []).map((a) => [a.id, a]))
  const evidenceByPerson = new Map<string, PersonEvidence[]>()
  for (const pe of research.person_evidence ?? []) {
    if (!pe.superseded_by) pushTo(evidenceByPerson, pe.person_id, pe)
  }

  const repoXref = new Map<string, string>()
  for (const { source } of index.research) {
    const name = source.repository?.trim()
    if (name && !repoXref.has(name)) repoXref.set(name, `@R${repoXref.size + 1}@`)
  }

  const questionText = new Map((research.questions ?? []).map((q) => [q.id, q.question]))
  const proofNotes = (research.proof_summaries ?? []).map((ps, i) => ({
    xref: `@N${i + 1}@`,
    ps
  }))

  // §2 Header
  w.text(0, 'HEAD')
  w.text(1, 'SOUR', 'GENEALOGY_RESEARCH_VIEWER')
  w.text(2, 'NAME', 'Genealogy Research Viewer')
  w.text(1, 'DATE', headerDate(opts.now ?? new Date()))
  w.pointer(1, 'SUBM', '@U1@')
  w.text(1, 'FILE', gedcomFileName(research))
  w.text(1, 'GEDC')
  w.text(2, 'VERS', '5.5.1')
  w.text(2, 'FORM', 'LINEAGE-LINKED')
  w.text(1, 'CHAR', 'UTF-8')
  if (research.project?.objective) {
    w.text(1, 'NOTE', `Research objective: ${research.project.objective}`)
  }
  w.text(0, 'SUBM', undefined, '@U1@')
  w.text(1, 'NAME', 'Genealogy Research Viewer user')

  // §4 Individuals
  for (const person of persons) {
    w.text(0, 'INDI', undefined, indiXref.get(person.id))
    const names = [...(person.names ?? [])].sort(
      (a, b) => Number(Boolean(b.preferred)) - Number(Boolean(a.preferred))
    )
    for (const name of names) writeName(w, name, index)
    w.text(1, 'SEX', person.gender === 'Male' ? 'M' : person.gender === 'Female' ? 'F' : 'U')

    const fsLink = familySearchTreeLink(person.ark)
    if (fsLink) {
      w.text(1, '_FSFTID', fsLink.pid)
      w.text(1, 'REFN', fsLink.pid)
      w.text(2, 'TYPE', 'FamilySearch')
      w.text(1, 'NOTE', `FamilySearch: ${fsLink.url}`)
    }

    // §4.3 Evidence citations, grouped by the assertion's research source. Built
    // first so a plain person-level ref to the same source is not written twice.
    const evidence = evidenceByPerson.get(person.id) ?? []
    const bySource = new Map<ResearchSourceEntry, string[]>()
    const linkedAssertions = new Set<string>()
    for (const pe of evidence) {
      const assertion = assertionById.get(pe.assertion_id)
      if (!assertion) continue
      linkedAssertions.add(assertion.id)
      const entry = index.byResearchId.get(assertion.source_id)
      if (entry) pushTo(bySource, entry, assertionLine(assertion, pe))
    }
    const evidenceXrefs = new Set([...bySource.keys()].map((e) => e.xref))

    for (const fact of person.facts ?? []) writePersonFact(w, fact, index)
    writeSourceRefs(w, 1, person.sources, index, evidenceXrefs)

    for (const { fam, child } of famcOf.get(person.id) ?? []) {
      w.pointer(1, 'FAMC', fam.xref)
      const subtype = child.edges.find((e) => e.subtype)?.subtype
      if (subtype && PEDIGREE[subtype]) w.text(2, 'PEDI', PEDIGREE[subtype])
      else if (subtype === 'Step' || subtype === 'Guardian') w.text(2, 'NOTE', `${subtype} parent`)
      for (const edge of child.edges) for (const note of edge.notes ?? []) w.text(2, 'NOTE', note)
    }
    for (const famXref of famsOf.get(person.id) ?? []) w.pointer(1, 'FAMS', famXref)
    // Both parent edges usually cite the same record; cite it once.
    const edgeRefs = new Map<string, GedcomxSourceRef>()
    for (const { child } of famcOf.get(person.id) ?? []) {
      for (const edge of child.edges) {
        for (const ref of edge.sources ?? []) {
          edgeRefs.set(`${ref.ref}|${ref.page ?? ''}|${ref.quality ?? ''}`, ref)
        }
      }
    }
    writeSourceRefs(w, 1, [...edgeRefs.values()], index, evidenceXrefs)

    for (const [entry, lines] of bySource) {
      w.pointer(1, 'SOUR', entry.xref)
      const page = entry.source.citation_detail?.where_within
      if (page) w.text(2, 'PAGE', page)
      w.text(2, 'NOTE', lines.join('\n'))
    }

    for (const { xref } of proofNotes) w.pointer(1, 'NOTE', xref)

    // §4.4 Research notes
    const touches = (ids: string[] | undefined): boolean =>
      (ids ?? []).some((id) => linkedAssertions.has(id))
    for (const c of research.conflicts ?? []) {
      if (!touches(c.competing_assertion_ids)) continue
      const parts = [`Conflict (${c.status}): ${c.description}`]
      if (c.resolved_value) parts.push(`Resolved value: ${c.resolved_value}`)
      if (c.resolution_rationale) parts.push(`Rationale: ${c.resolution_rationale}`)
      w.text(1, 'NOTE', parts.join('\n'))
    }
    for (const h of research.hypotheses ?? []) {
      if (!touches([...(h.supporting_assertion_ids ?? []), ...(h.contradicting_assertion_ids ?? [])])) {
        continue
      }
      const parts = [`Hypothesis (${h.status}): ${h.claim}`]
      if (h.ruled_out_reason) parts.push(`Ruled out: ${h.ruled_out_reason}`)
      if (h.notes) parts.push(h.notes)
      w.text(1, 'NOTE', parts.join('\n'))
    }
    const questionIds = new Set<string>()
    for (const id of linkedAssertions) {
      for (const q of assertionById.get(id)?.extracted_for_question_ids ?? []) questionIds.add(q)
    }
    for (const q of research.questions ?? []) {
      if (questionIds.has(q.id)) w.text(1, 'NOTE', `Research question (${q.status}): ${q.question}`)
    }
  }

  // §5 Families
  for (const fam of families) {
    w.text(0, 'FAM', undefined, fam.xref)
    const { husb, wife } = husbandAndWife(fam.parentIds, sexOf)
    if (husb) w.pointer(1, 'HUSB', indiXref.get(husb)!)
    if (wife) w.pointer(1, 'WIFE', indiXref.get(wife)!)
    for (const child of fam.children) w.pointer(1, 'CHIL', indiXref.get(child.childId)!)
    for (const couple of fam.couples) {
      for (const fact of couple.facts ?? []) writeCoupleFact(w, fact, index)
      for (const note of couple.notes ?? []) w.text(1, 'NOTE', note)
      writeSourceRefs(w, 1, couple.sources, index)
    }
  }

  // §6 Sources and repositories
  for (const { xref, source, tree } of index.research) {
    const detail = source.citation_detail
    w.text(0, 'SOUR', undefined, xref)
    w.text(1, 'TITL', tree?.title || detail?.what || source.citation || source.id)
    const author = tree?.author || detail?.who
    if (author) w.text(1, 'AUTH', author)
    const publ = [detail?.where, detail?.when_created].filter((x) => x && x.trim()).join(', ')
    if (publ) w.text(1, 'PUBL', publ)
    const repo = repoXref.get(source.repository?.trim() ?? '')
    if (repo) w.pointer(1, 'REPO', repo)
    if (source.transcription) {
      const prefix = source.transcription_truncated ? '[partial transcription]\n' : ''
      w.text(1, 'TEXT', prefix + source.transcription)
    }
    const note = [
      source.citation && `Citation: ${source.citation}`,
      source.source_classification && `Classification: ${source.source_classification}`,
      source.url && `URL: ${source.url}`,
      source.url_archived && `Archived URL: ${source.url_archived}`,
      source.access_date && `Accessed: ${source.access_date}`,
      source.notes && `Notes: ${source.notes}`
    ].filter(Boolean)
    if (note.length) w.text(1, 'NOTE', note.join('\n'))
  }
  for (const { xref, source } of index.treeOnly) {
    w.text(0, 'SOUR', undefined, xref)
    w.text(1, 'TITL', source.title || source.id)
    if (source.author) w.text(1, 'AUTH', source.author)
    const note = [
      source.citation && `Citation: ${source.citation}`,
      source.url && `URL: ${source.url}`
    ].filter(Boolean)
    if (note.length) w.text(1, 'NOTE', note.join('\n'))
  }
  for (const [name, xref] of repoXref) {
    w.text(0, 'REPO', undefined, xref)
    w.text(1, 'NAME', name)
  }

  // §7 Proof notes
  for (const { xref, ps } of proofNotes) {
    const question = questionText.get(ps.question_id) ?? ps.question_id
    const body = [
      `Proof conclusion — ${question} (Tier: ${ps.tier})`,
      ps.narrative_markdown,
      ps.exhaustive_search_summary && `Search summary: ${ps.exhaustive_search_summary}`
    ].filter(Boolean)
    w.text(0, 'NOTE', body.join('\n'), xref)
  }

  w.text(0, 'TRLR')
  return w.toString()
}
