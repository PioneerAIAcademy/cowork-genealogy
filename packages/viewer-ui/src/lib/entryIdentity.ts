// "The card shows its identity while collapsed, or two sources with one title cannot
// be told apart." — the parent plan's chip item, deferred there and ruled build-it by
// the lead on 2026-10-13.
//
// A collapsed research-log row shows the date, the tool, the outcome and a result
// count. Two searches of the same tool on the same day are therefore identical on
// screen, and a run makes many: the reader has to open each one to find out which is
// which. What distinguishes them is the QUERY — who was searched for, where, and when.

/** Keys worth showing, in priority order. Keys outside this list are deliberately
 * dropped: a log row is an identity line, not a dump, and an unbounded join is how one
 * row becomes three lines wide.
 *
 * SNAKE_CASE, because this reads `research.json`, and persisted project documents are
 * snake_case throughout (CLAUDE.md, "Identifier casing"). The first cut of this list was
 * camelCase -- MCP tool-parameter style -- so `birth_place`, `birth_year`, `death_place`,
 * `death_year` and `person_id` never matched anything at all, and only the single-word
 * keys worked by accident. Found by opening the sample project in a browser; the unit
 * tests had encoded the same mistake, so they passed throughout.
 *
 * Order is by how DISCRIMINATING a key is, not by reading order, because three parts is
 * the whole budget. A person's `birth_place`/`birth_year` are the subject's own
 * attributes, repeated verbatim in every query about them, so they are nearly worthless
 * for telling two of that person's searches apart and rank last. What the search was
 * FOR -- the collection, the event type, the jurisdiction and period of the event --
 * is what actually differs between rows, so it ranks directly after the name. */
const IDENTITY_KEYS = [
  // who
  'given',
  'surname',
  'name',
  'person_id',
  // what was searched for
  'collection',
  'event_type',
  'title',
  // where and when the EVENT was
  'death_place',
  'jurisdiction',
  'place',
  'death_year',
  'date_range',
  'death_year_range',
  'year',
  // the subject's own attributes -- least discriminating, so last
  'birth_place',
  'birth_year'
] as const

/** At most this many parts, so one row stays one line. */
const MAX_PARTS = 3

/**
 * A short identity for a log entry's query, or '' when there is nothing to say.
 *
 * Empty string rather than a placeholder: a row with no usable query should fall back
 * to what it already showed, not gain a row of em-dashes.
 */
export function entryIdentity(query: unknown): string {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return ''
  const q = query as Record<string, unknown>
  const parts: string[] = []
  const seen = new Set<string>()

  // `given` and `surname` read as one person, not two facts.
  const given = typeof q.given === 'string' ? q.given.trim() : ''
  const surname = typeof q.surname === 'string' ? q.surname.trim() : ''
  if (given || surname) {
    parts.push([given, surname].filter(Boolean).join(' '))
    seen.add('given')
    seen.add('surname')
  }

  for (const key of IDENTITY_KEYS) {
    if (parts.length >= MAX_PARTS) break
    if (seen.has(key)) continue
    const value = q[key]
    if (typeof value === 'string' && value.trim()) parts.push(value.trim())
    else if (typeof value === 'number') parts.push(String(value))
  }
  return parts.join(' · ')
}
