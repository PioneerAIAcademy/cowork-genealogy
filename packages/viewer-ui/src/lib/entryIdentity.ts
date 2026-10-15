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
 * BOTH casings, because `log[].query` is not consistently either and both shapes exist
 * on disk today. Measured, rather than reasoned from the convention: the committed
 * McAndrew capture -- a real hosted run -- writes 145 camelCase keys and no snake_case
 * ones (`collectionId` 43, `givenName` 22, `residencePlace` 12), while the seeded sample
 * project writes 14 snake_case keys and no camelCase ones.
 *
 * The reason is that this field is a COPY OF THE MCP TOOL'S PARAMETERS, and tool
 * parameters are camelCase (CLAUDE.md, "Identifier casing") -- so the agent writes camel
 * straight through, while whoever hand-wrote the fixture used the persisted convention
 * that governs the rest of the document. An earlier cut of this list was camel-only and
 * matched nothing in the fixture; the cut after it was snake-only and matched nothing in
 * a real run. Reading both is what makes every project already on disk render.
 *
 * Which casing SHOULD be written is a separate question about the writer and the
 * fixture, not about this renderer.
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
  'personId',
  // what was searched for
  'collection',
  'collectionId',
  'event_type',
  'eventType',
  'title',
  'recordId',
  // where and when the EVENT was
  'death_place',
  'deathPlace',
  'jurisdiction',
  'place',
  'residencePlace',
  'standardPlace',
  'death_year',
  'deathYearFrom',
  'date_range',
  'death_year_range',
  'year',
  'startYear',
  // the subject's own attributes -- least discriminating, so last
  'birth_place',
  'birthPlace',
  'birth_year',
  'birthYearFrom'
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

  // `given` and `surname` read as one person, not two facts — in EITHER casing, and
  // both are marked seen so the generic loop below cannot append the given name a
  // second time after the joined one.
  const str = (key: string): string => (typeof q[key] === 'string' ? (q[key] as string).trim() : '')
  const given = str('given') || str('givenName')
  const surname = str('surname') || str('surnameAlt')
  if (given || surname) {
    parts.push([given, surname].filter(Boolean).join(' '))
    for (const key of ['given', 'givenName', 'surname', 'surnameAlt']) seen.add(key)
  }

  // De-duplicated by VALUE, not just by key. Several of the keys above routinely carry
  // the same string -- `place`, `jurisdiction` and `death_place` are all "where", and a
  // `name` can repeat what `given` + `surname` already produced -- and repeating it
  // reads as a rendering fault while spending one of only three slots.
  const push = (value: string): void => {
    if (!parts.includes(value)) parts.push(value)
  }

  for (const key of IDENTITY_KEYS) {
    if (parts.length >= MAX_PARTS) break
    if (seen.has(key)) continue
    const value = q[key]
    if (typeof value === 'string' && value.trim()) push(value.trim())
    else if (typeof value === 'number') push(String(value))
  }
  return parts.join(' · ')
}
