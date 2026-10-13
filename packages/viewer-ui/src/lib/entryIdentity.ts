// "The card shows its identity while collapsed, or two sources with one title cannot
// be told apart." — the parent plan's chip item, deferred there and ruled build-it by
// the lead on 2026-10-13.
//
// A collapsed research-log row shows the date, the tool, the outcome and a result
// count. Two searches of the same tool on the same day are therefore identical on
// screen, and a run makes many: the reader has to open each one to find out which is
// which. What distinguishes them is the QUERY — who was searched for, where, and when.

/** Keys worth showing, in reading order: who, then where, then when, then in what.
 *
 * Ordered rather than alphabetical because the reader scans for a person first. Keys
 * outside this list are deliberately dropped: a log row is an identity line, not a
 * dump, and an unbounded join is how one row becomes three lines wide. */
const IDENTITY_KEYS = [
  'given',
  'surname',
  'name',
  'personId',
  'place',
  'birthPlace',
  'deathPlace',
  'year',
  'birthYear',
  'deathYear',
  'collection',
  'title'
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
