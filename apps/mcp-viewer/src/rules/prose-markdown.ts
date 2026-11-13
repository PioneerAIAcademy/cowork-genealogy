import {
  arkHref,
  bareId,
  FS_ORIGIN,
  isPageImageArk,
  personHref,
  type PersonEntry,
  type RecordEntry,
  type RuleIndex
} from './rule-index'

// Private-use characters never typed into project text.
const HOLD_OPEN = '\uE000'
const HOLD_CLOSE = '\uE001'
const GONE = '\uE002'
const HOLD_RE = /\uE000(\d+)\uE001/g

const INTERNAL = String.raw`(?:[SIRFN]\d+|(?:a|c|ev|h|loc|log|ns|p|pe|pl|pli|ps|q|rj|rp|src|t)_\d+)`
const PID_SHAPE = String.raw`[A-Z0-9]{4}(?:-[A-Z0-9]{3,4})+`
const ITEM = String.raw`(?:(?<!\w)${INTERNAL}(?!\w)|(?<![\w-])(?=[A-Z0-9-]*[A-Z])${PID_SHAPE}(?![\w-]))`
const JOINER = String.raw`(?:and|or|vs\.?)`
const SEP = String.raw`(?:[ \t]*(?:<?->|[,;/+&→–—-])[ \t]*(?:${JOINER}[ \t]+)?|[ \t]+(?:${JOINER}[ \t]+)?)`
const RUN_RE = new RegExp(`${ITEM}(?:${SEP}${ITEM})*`, 'g')
const ITEM_RE = new RegExp(ITEM, 'g')
const PID_TOKEN_RE = new RegExp(String.raw`(?<![\w-])(?=[A-Z0-9-]*[A-Z])${PID_SHAPE}(?![\w-])`, 'g')
const LABEL_BEFORE_RE =
  /(?:^|(?<=[\s([]))(?:(?:and|or|vs\.?|&)[ \t]+)?(?:see also|see|assertions?|sources?|tree sources?|tree persons?|for|as|ARK|and|or|vs\.?|&)[ \t]*:?[ \t]*$/i

const ARK_RE = /ark:\/61903\/(\d:\d:[A-Z0-9]+(?:-[A-Z0-9]+)+)(?:\?[^\s)\]]*)?/g
const BARE_ARK_RE = /(?<![A-Za-z0-9/:])(\d:\d:[A-Z0-9]+(?:-[A-Z0-9]+)+)(?![A-Za-z0-9-])/g
const MD_LINK_RE = /!?\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"\n]*")?\)/g
const URL_RE = /https?:\/\/[^\s<>]+/g
const TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', '"', "'", '<', '>', ']', '*', '_'])

/** The rule of viewer-ui's Linkify: trailing punctuation, and an unbalanced `)`, are prose. */
function splitTrailingPunctuation(raw: string): [string, string] {
  let end = raw.length
  while (end > 0) {
    const ch = raw[end - 1]
    if (TRAILING_PUNCT.has(ch)) {
      end--
      continue
    }
    if (ch === ')') {
      const head = raw.slice(0, end)
      if ((head.match(/\)/g) ?? []).length > (head.match(/\(/g) ?? []).length) {
        end--
        continue
      }
    }
    break
  }
  return [raw.slice(0, end), raw.slice(end)]
}

function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, (c) => `\\${c}`)
}

function link(label: string, href: string): string {
  return `[${escapeLabel(label)}](${href})`
}

function personLink(person: PersonEntry | null, pid: string): string {
  return link(person?.name ?? 'this person on FamilySearch', personHref(pid))
}

function arkLink(ark: string, index: RuleIndex, href = arkHref(ark)): string {
  if (isPageImageArk(ark)) return link('page image on FamilySearch', href)
  const id = bareId(ark)
  if (/^ark:\/61903\/4:/.test(ark)) {
    const person = index.pidToPerson.get(id) ?? null
    return link(person?.name ?? 'this person on FamilySearch', href)
  }
  return link(recordTitle(index.records.get(ark) ?? null) ?? 'this record on FamilySearch', href)
}

/** A FamilySearch URL rebuilt on the one origin, named for what it is; null for any other URL. */
function familySearchLink(raw: string, index: RuleIndex): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.hostname !== 'familysearch.org' && url.hostname !== 'www.familysearch.org') return null
  if (url.username !== '' || url.password !== '') return null

  const path = url.pathname
  const ark = /^\/ark:\/61903\/(\d:\d:[A-Za-z0-9-]+)$/.exec(path)
  if (ark) return arkLink(`ark:/61903/${ark[1]}`, index)

  const href = `${FS_ORIGIN}${path}${url.search}${url.hash}`
  const person = /^\/tree\/person\/(?:details\/)?([A-Z0-9]{4}-[A-Z0-9]{3,4})\/?$/.exec(path)
  if (person) return link(index.pidToPerson.get(person[1])?.name ?? 'this person on FamilySearch', href)
  if (/^\/search\/collection\/\d+\/?$/.test(path)) return link('collection on FamilySearch', href)
  const wiki = /^\/(?:[a-z]{2}\/)?wiki\/(?:[a-z]{2}\/)?([^/]+)$/.exec(path)
  if (wiki) {
    let title = wiki[1]
    try {
      title = decodeURIComponent(title)
    } catch {
      // keep it as written
    }
    return link(title.replace(/_/g, ' '), href)
  }
  return link('on FamilySearch', href)
}

function itemName(token: string, index: RuleIndex): string | null {
  if (/^I\d+$/.test(token)) return index.persons.get(token)?.name ?? null
  if (/^(?:S\d+|src_\d+)$/.test(token)) return recordTitle(index.sources.get(token) ?? null)
  if (/^a_\d+$/.test(token)) return recordTitle(index.assertions.get(token)?.record ?? null)
  if (/^pe_\d+$/.test(token)) return index.links.get(token)?.name ?? null
  return null
}

/** A record's title with any ids in it removed; null when nothing names it. */
export function recordTitle(record: RecordEntry | null): string | null {
  if (!record || record.title === 'this record') return null
  return stripIds(record.title) || null
}

const NO_NAMES: RuleIndex = {
  persons: new Map(),
  pidToPerson: new Map(),
  records: new Map(),
  sources: new Map(),
  assertions: new Map(),
  questions: new Map(),
  links: new Map()
}

/** Text from the documents used as a label: every id and URL in it goes, nothing becomes a link. */
function stripIds(text: string): string {
  let out = text
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(URL_RE, '')
    .replace(ARK_RE, 'log_0')
    .replace(BARE_ARK_RE, 'log_0')
  const edits = [...out.matchAll(RUN_RE)].map((m) => editRun(out, m.index ?? 0, m[0], NO_NAMES))
  for (const edit of edits.reverse()) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  return tidyBrackets(out)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
}

function bracketDepth(text: string, end: number): number {
  let depth = 0
  for (let i = 0; i < end; i++) {
    const ch = text[i]
    if (ch === '(' || ch === '[') depth++
    else if ((ch === ')' || ch === ']') && depth > 0) depth--
  }
  return depth
}

function normal(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

interface Edit {
  start: number
  end: number
  text: string
}

/** Names a run outside brackets, or marks it gone. */
function editRun(text: string, start: number, run: string, index: RuleIndex): Edit {
  const end = start + run.length
  const names: string[] = []
  const joins: string[] = []
  if (bracketDepth(text, start) === 0) {
    let last = 0
    let pendingSep = ''
    for (const match of run.matchAll(ITEM_RE)) {
      const at = match.index ?? 0
      const sep = run.slice(last, at)
      last = at + match[0].length
      if (sep) pendingSep = sep
      const name = itemName(match[0], index)
      if (!name || names.includes(name)) continue
      if (names.length > 0) joins.push(pendingSep)
      names.push(name)
      pendingSep = ''
    }
  }

  if (names.length > 0) {
    let named = names[0]
    names.slice(1).forEach((name, i) => (named += joins[i] + name))
    let stop = end
    const repeat = /^[ \t]*\(([^()\n]*)\)/.exec(text.slice(end))
    if (repeat && names.some((n) => normal(n) === normal(repeat[1]))) stop = end + repeat[0].length
    return { start, end: stop, text: named }
  }

  let from = start
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--
  const label = LABEL_BEFORE_RE.exec(text.slice(0, from))
  if (label) {
    from -= label[0].length
    while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--
  }
  return { start: from, end, text: GONE }
}

const EDGE_SEP = String.raw`(?:[\s,;:/+&→–—-]|\b(?:and|or|vs)\b\.?)*`
const INNER_GONE_RE = /([([])([^()[\]]*\uE002[^()[\]]*)([)\]])/

/** Tidies each bracket a removal touched, innermost first. */
function tidyBrackets(text: string): string {
  let out = text
  for (;;) {
    const match = INNER_GONE_RE.exec(out)
    if (!match) break
    let body = match[2].replace(/\uE002/g, '')
    body = body.replace(new RegExp(`^${EDGE_SEP}`), '').replace(new RegExp(`${EDGE_SEP}$`), '')
    body = body.replace(/[ \t]*([,;])(?:[ \t]*[,;])+/g, '$1').replace(/[ \t]{2,}/g, ' ')
    const start = match.index
    const end = start + match[0].length
    if (/[\p{L}\p{N}]/u.test(body)) {
      out = out.slice(0, start) + match[1] + body + match[3] + out.slice(end)
    } else {
      let from = start
      while (from > 0 && (out[from - 1] === ' ' || out[from - 1] === '\t')) from--
      out = out.slice(0, from) + out.slice(end)
    }
  }
  return out
    .replace(/(^|\n)\uE002[ \t]*/g, '$1')
    .replace(/\uE002/g, '')
    .replace(/[ \t]*([,;])(?:[ \t]*[,;])+/g, '$1')
}

/** Project prose as markdown: internal ids named or gone, FamilySearch identifiers as named links. */
export function proseMarkdown(text: string, index: RuleIndex): string {
  if (typeof text !== 'string' || text === '') return ''
  const held: string[] = []
  const hold = (value: string): string => `${HOLD_OPEN}${held.push(value) - 1}${HOLD_CLOSE}`

  let out = text
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\b([a-z]{1,3})\\_(\d+)\b/g, '$1_$2')
    .replace(MD_LINK_RE, (m) => hold(m))
  out = out.replace(URL_RE, (raw) => {
    const [url, trailing] = splitTrailingPunctuation(raw)
    return hold(familySearchLink(url, index) ?? url) + trailing
  })
  out = out.replace(ARK_RE, (_m, id: string) => hold(arkLink(`ark:/61903/${id}`, index)))
  out = out.replace(BARE_ARK_RE, (_m, id: string) => hold(arkLink(`ark:/61903/${id}`, index)))
  const personHolds: Array<[string, string]> = []
  out = out.replace(PID_TOKEN_RE, (token) => {
    if (index.pidToPerson.has(token)) {
      const person = index.pidToPerson.get(token) ?? null
      const held = hold(personLink(person, token))
      if (person?.name) personHolds.push([person.name, held])
      return held
    }
    const record = index.records.get(token)
    if (record) return hold(arkLink(record.ark, index))
    return token
  })
  out = out.replace(/\bARK:?[ \t]*(?=\uE000)/g, '')

  const edits: Edit[] = []
  for (const match of out.matchAll(RUN_RE)) {
    edits.push(editRun(out, match.index ?? 0, match[0], index))
  }
  for (const edit of edits.reverse()) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  out = tidyBrackets(out)

  // A person's name straight before a bracket holding only their page link, once the
  // ids are names too ("**I1** (KWJ6-RPH)"): the name becomes the link, the bracket goes.
  for (const [name, held] of personHolds) {
    const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`${escaped(name)}(\\*{0,2})[ \\t]*\\(${escaped(held)}\\)`), `${held}$1`)
  }

  for (let i = 0; i < 4 && out.includes(HOLD_OPEN); i++) {
    out = out.replace(HOLD_RE, (_m, n: string) => held[Number(n)])
  }
  return out
}
