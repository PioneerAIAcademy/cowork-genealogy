// Phase 2 item 1: schema identifiers in chat prose are additive links, never dead text.
//
// Measured on the first captured hosted session
// (docs/captures/2026-09-29-mcandrew-children/): 193 occurrences of 94 distinct ids
// reach the READER across 190 rendered paragraphs -- a_ 61, pe_ 47, src_ 38, pli_ 24,
// log_ 14, q_ 7, pl_ 2. None of them goes anywhere today.
//
// Counting note kept deliberately: an earlier pass counted 405/164 by scanning the
// FEED rather than the screen (the client drops sub-agent prose, chatEvents.ts:154)
// and its pattern omitted `src_` and `log_` while including `pli_`. `src_` is the
// source card a reader most wants to open, so the scope here is the full set.

/** The prefixes the capture actually contains.
 *
 * Listed longest-first for readability ONLY -- order is not load-bearing, and a
 * mutation test proved it: reordering `pl` ahead of `pli` leaves every test green,
 * because the required `_` after the prefix forces the engine to backtrack from
 * `pl` to `pli` for `pli_003`. Do not preserve this order believing it is a
 * constraint; the disambiguation is the `_`, not the sequence.
 */
export const SCHEMA_ID_PREFIXES = ['pli', 'src', 'log', 'pe', 'pl', 'q', 'a'] as const

export type SchemaIdPrefix = (typeof SCHEMA_ID_PREFIXES)[number]

export interface SchemaIdHit {
  id: string
  prefix: SchemaIdPrefix
  start: number
  end: number
}

/** Where each prefix lives, mirroring viewer-ui's CrossLink `sectionNavMap`. */
const SECTION_BY_PREFIX: Record<SchemaIdPrefix, string> = {
  q: 'questions',
  pl: 'plans',
  pli: 'plans', // a plan item is rendered inside its plan
  a: 'assertions',
  pe: 'person_evidence',
  src: 'sources',
  log: 'log'
}

// Three digits exactly -- the schema mints `a_001`, never `a_1` or `a_1234`, so a
// looser pattern would claim ordinary prose. Bounded by non-word characters on both
// sides so `media_001` and `a_001x` are left alone.
const ID_RE = new RegExp(
  String.raw`(?<![\w-])(${SCHEMA_ID_PREFIXES.join('|')})_(\d{3})(?![\w-])`,
  'g'
)

// Ids inside a URL are Linkify's job; claiming one here nests a link inside a link.
// This is a SPAN test, not a "preceded by /" test: the captured prose contains
// `a_105/a_022`, two assertions separated by a slash, and a slash rule silently
// dropped the second one. Shape found in the real corpus, not invented.
const URL_RE = /https?:\/\/[^\s]+/g

/**
 * Every schema id in `text`, with positions so a caller can split around them.
 *
 * Ids inside a URL are NOT returned: a URL is Linkify's job, and claiming one here
 * would nest a link inside a link. That is what the `/` in the lookbehind excludes.
 */
export function findSchemaIds(text: string): SchemaIdHit[] {
  const urls: Array<[number, number]> = []
  for (const u of text.matchAll(URL_RE)) {
    const s = u.index ?? 0
    urls.push([s, s + u[0].length])
  }
  const inUrl = (i: number): boolean => urls.some(([s, e]) => i >= s && i < e)

  const out: SchemaIdHit[] = []
  for (const m of text.matchAll(ID_RE)) {
    const start = m.index ?? 0
    if (inUrl(start)) continue
    out.push({
      id: m[0],
      prefix: m[1] as SchemaIdPrefix,
      start,
      end: start + m[0].length
    })
  }
  return out
}

/** The viewer section that holds `id`, or null when it cannot be placed --
 *  in which case the caller must leave the text exactly as it found it. */
export function sectionForId(id: string): string | null {
  const m = /^([a-z]+)_\d{3}$/.exec(id)
  if (!m) return null
  const prefix = m[1] as SchemaIdPrefix
  return SECTION_BY_PREFIX[prefix] ?? null
}

// --- FamilySearch identifiers in chat prose (issue #4582) --------------------
//
// From feedback #4561: a reply names an image or record by a bare ARK or image id
// and a beginner cannot open it. These become links on EVERY path, project or not,
// because the href is rebuilt from a FamilySearch constant (resolveFamilySearchTarget /
// imageIdToViewerUrl) or host-pinned by the regex below -- it can only point at
// familysearch.org. Person ids are deliberately NOT scanned: a record id shares a
// bare person id's shape, so a bare one is only ever linked when matched AS an ARK.

/** A FamilySearch target found in prose, with the href it resolves to and its span. */
export interface FamilySearchHit {
  /** The text slice to show as the link's label (trailing punctuation trimmed off). */
  raw: string
  /** The resolved, host-pinned FamilySearch URL. */
  href: string
  start: number
  end: number
}

// A bare ARK token: `ark:/61903/<n>:<n>:<id>`. The id charset matches the producer
// (familysearch-url.ts ARK_RE). A sentence-final `.` is legal in the charset, so it is
// trimmed below rather than excluded here.
const ARK_IN_PROSE_RE = /ark:\/61903\/\d:\d:[A-Za-z0-9.-]+/g

// A familysearch.org address written with NO scheme -- the one shape GitHub-flavoured
// markdown does not autolink (it autolinks `www.` and `http(s)://` only), so it reaches
// us as plain prose. The `/` after `.org` is load-bearing: it rejects
// `familysearch.org.evil.com`, exactly as familysearch-url.ts's FS_URL_PREFIX_RE does.
const SCHEMELESS_FS_URL_RE = /(?:www\.)?familysearch\.org\/[^\s)]+/g

// A digitized-image id: NUMBER_NUMBER, bounded so a schema id (lowercase prefix) and an
// image-GROUP number (no underscore) are both left alone -- the `_` is what separates
// a linkable image id from a bare group number the issue says to leave plain.
const IMAGE_ID_IN_PROSE_RE = /(?<![\w-])\d+_\d+(?![\w-])/g

// Trailing sentence punctuation the greedy charsets above can swallow. Trimmed so a
// period at the end of a sentence stays plain text and is not folded into the link.
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/

/**
 * Every FamilySearch identifier in `text` that resolves to a link, with positions so a
 * caller can split the prose around it.
 *
 * `resolve` is injected so this module stays free of the viewer-ui import at the type
 * level; `SchemaIdText` passes `resolveFamilySearchTarget` and `imageIdToViewerUrl`.
 * Anything already inside a full `http(s)://` URL is skipped: gfm autolinks it into its
 * own node, and claiming the ark inside it would nest a link in a link.
 */
export function findFamilySearchTargets(
  text: string,
  resolveArk: (v: string) => string | null,
  resolveImageId: (v: string) => string | null
): FamilySearchHit[] {
  // Spans already claimed -- a later, lower-priority pattern must not match inside one.
  const claimed: Array<[number, number]> = []
  for (const u of text.matchAll(URL_RE)) {
    const s = u.index ?? 0
    claimed.push([s, s + u[0].length])
  }
  const overlaps = (s: number, e: number): boolean =>
    claimed.some(([cs, ce]) => s < ce && cs < e)

  const hits: FamilySearchHit[] = []
  const add = (matched: string, start: number, resolve: (v: string) => string | null): void => {
    const raw = matched.replace(TRAILING_PUNCT_RE, '')
    if (raw === '') return
    const end = start + raw.length
    if (overlaps(start, end)) return
    const href = resolve(raw)
    if (!href) return
    hits.push({ raw, href, start, end })
    claimed.push([start, end])
  }

  // Order matters: a scheme-less FS URL contains an ark substring, so claim the URL
  // first and the ark pass then skips what sits inside it.
  for (const m of text.matchAll(SCHEMELESS_FS_URL_RE)) add(m[0], m.index ?? 0, (v) => `https://${v}`)
  for (const m of text.matchAll(ARK_IN_PROSE_RE)) add(m[0], m.index ?? 0, resolveArk)
  for (const m of text.matchAll(IMAGE_ID_IN_PROSE_RE)) add(m[0], m.index ?? 0, resolveImageId)

  return hits.sort((a, b) => a.start - b.start)
}
