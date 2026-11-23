/**
 * Which of a locality's collections each `record_types` row covers (research-append-tool-spec
 * §5.14, "The record-type rows").
 *
 * The agent writes what needs the wiki prose (where the records are held, the level, the summary,
 * the source, a loss, an offline or lost `access`). Which collections belong to a type is a match
 * of titles the entry already holds, so the tool makes it. It fills nothing else: one type spans
 * several events and centuries, so a single years span or access word for it would misstate the
 * years a reader asks about; a reader takes each listed collection's own date range and indexed
 * count. `collection_ids` is filled only when absent or empty, only on the first row of a type,
 * and only from a clear match: a collection title goes to the first type its words name.
 */

/** Title words, in order: the first type whose pattern matches a collection title takes it. */
const TITLE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["census", /\bcensus|\benumerat/i],
  ["church", /\bchurch|\bparish|\bbaptism|\bchristening|\bdiocese|\bcatholic|\blutheran|\bmethodist|\bpresbyterian|\bkirchenb|\bparroquial|\bsacramental/i],
  ["cemetery", /\bcemeter|\bgrave|\bburials?\b/i],
  ["immigration", /\bimmigra|\bemigra|\bpassenger|\bnaturali[sz]|\bpassport|\bborder crossing/i],
  ["probate", /\bprobate|\bwills?\b|\bestate files|\btestament/i],
  ["court", /\bcourts?\b/i],
  ["land", /\bland\b|\bdeeds?\b|\bhomestead|\bproperty/i],
  ["military", /\bmilitary|\bdraft\b|\barmy\b|\bnavy\b|\bsoldiers?\b|\bpension|\bservice records|\bwar\b/i],
  ["tax", /\btax|\btithe|\bassessment/i],
  ["newspaper", /\bnewspaper|\bobituar/i],
  ["vital_record", /\bbirths?\b|\bdeaths?\b|\bmarriages?\b|\bcivil registration|\bvital|\bdivorces?\b/i],
];

/** The type a collection title names, or null. */
export function recordTypeOfTitle(title: string): string | null {
  for (const [type, re] of TITLE_RULES) if (re.test(title)) return type;
  return null;
}

/** Per type, the ids of the entry's collections whose titles name it. */
export function collectionIdsByType(entry: any): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of Array.isArray(entry?.collections) ? entry.collections : []) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.title !== "string") continue;
    const type = recordTypeOfTitle(c.title);
    if (type) out.set(type, [...(out.get(type) ?? []), c.id]);
  }
  return out;
}

/** Fill `entry.record_types` in place: each type's first row gets its collections' ids, and a row
 *  with no `access` gets `unknown`. Returns how many fields it filled. */
export function fillRecordTypeRows(entry: any): number {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.record_types)) return 0;
  const ids = collectionIdsByType(entry);
  const seen = new Set<string>();
  let filled = 0;
  for (const row of entry.record_types) {
    if (!row || typeof row !== "object") continue;
    if (row.access === undefined || row.access === null) {
      row.access = "unknown";
      filled++;
    }
    if (typeof row.type !== "string" || seen.has(row.type)) continue;
    seen.add(row.type);
    const mine = ids.get(row.type) ?? [];
    const empty = row.collection_ids === undefined || (Array.isArray(row.collection_ids) && row.collection_ids.length === 0);
    if (empty && mine.length > 0) {
      row.collection_ids = mine;
      filled++;
    }
  }
  return filled;
}
