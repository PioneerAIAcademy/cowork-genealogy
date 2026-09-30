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
