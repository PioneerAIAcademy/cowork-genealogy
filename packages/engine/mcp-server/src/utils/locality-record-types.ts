/**
 * The mechanical fields of a locality's `record_types` rows, read from the entry's own
 * `collections` and `volume_summary` (research-append-tool-spec §5.14, "The record-type rows").
 *
 * The agent writes what needs the wiki prose (where the records are held, the level, the
 * summary, the source, a loss). Which collections cover a type, their years, and how the
 * records are reached online are counts the entry already holds, so the tool fills them and
 * the agent never copies them. A field is filled only when it is absent (`access` also when
 * `unknown`), only on the first row of a type, and only from a clear match: a collection title
 * goes to the first type its words name, and a type with no match is left as sent.
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

/** The `volume_summary` group that stands for a type. Court is left out: its group counts
 *  every probate volume too. */
const VOLUME_GROUP: Readonly<Record<string, string>> = {
  census: "Census",
  church: "Religious",
  cemetery: "Cemetery",
  immigration: "Migration",
  probate: "Probate",
  land: "Land",
  military: "Military",
  tax: "Tax",
  newspaper: "Newspapers",
  vital_record: "Vital",
};

/** The type a collection title names, or null. */
export function recordTypeOfTitle(title: string): string | null {
  for (const [type, re] of TITLE_RULES) if (re.test(title)) return type;
  return null;
}

const yearsOf = (range: unknown): number[] =>
  typeof range === "string" ? [...range.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => Number(m[1])) : [];

interface Derived {
  collection_ids: string[];
  years: string | null;
  access: string | null;
}

/** Per type, what the entry's collections and volume counts say. */
export function deriveRowFields(entry: any): Map<string, Derived> {
  const out = new Map<string, Derived>();
  const byType = new Map<string, any[]>();
  for (const c of Array.isArray(entry?.collections) ? entry.collections : []) {
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.title !== "string") continue;
    const type = recordTypeOfTitle(c.title);
    if (!type) continue;
    byType.set(type, [...(byType.get(type) ?? []), c]);
  }
  const buckets = new Map<string, any>();
  for (const b of Array.isArray(entry?.volume_summary?.by_record_type) ? entry.volume_summary.by_record_type : []) {
    if (b && typeof b === "object" && typeof b.group === "string") buckets.set(b.group, b);
  }
  for (const type of new Set([...byType.keys(), ...Object.keys(VOLUME_GROUP)])) {
    const cols = byType.get(type) ?? [];
    const years = cols.flatMap((c) => yearsOf(c.date_range));
    let access: string | null = null;
    if (cols.some((c) => Number.isInteger(c.person_count) && c.person_count > 0)) access = "indexed";
    else {
      const b = VOLUME_GROUP[type] ? buckets.get(VOLUME_GROUP[type]) : undefined;
      const known = b && Number.isInteger(b.volumes) && Number.isInteger(b.browse_only) && Number.isInteger(b.fulltext_only);
      if (known && b.volumes > 0) {
        const indexed = b.volumes - b.browse_only - b.fulltext_only;
        access = indexed > 0 ? "indexed" : b.fulltext_only > 0 ? "fulltext" : b.browse_only > 0 ? "browse" : null;
      } else if (cols.length > 0 && cols.every((c) => c.person_count === 0)) {
        access = "browse";
      }
    }
    if (cols.length === 0 && access === null) continue;
    out.set(type, {
      collection_ids: cols.map((c) => c.id as string),
      years: years.length > 0 ? `${Math.min(...years)}-${Math.max(...years)}` : null,
      access,
    });
  }
  return out;
}

/** Fill `entry.record_types` in place; returns how many fields it filled. */
export function fillRecordTypeRows(entry: any): number {
  if (!entry || typeof entry !== "object" || !Array.isArray(entry.record_types)) return 0;
  const derived = deriveRowFields(entry);
  const seen = new Set<string>();
  let filled = 0;
  for (const row of entry.record_types) {
    if (!row || typeof row !== "object" || typeof row.type !== "string" || seen.has(row.type)) continue;
    seen.add(row.type);
    const d = derived.get(row.type);
    if (!d) {
      if (row.access === undefined || row.access === null) {
        row.access = "unknown";
        filled++;
      }
      continue;
    }
    if ((row.collection_ids === undefined || (Array.isArray(row.collection_ids) && row.collection_ids.length === 0)) && d.collection_ids.length > 0) {
      row.collection_ids = d.collection_ids;
      filled++;
    }
    if ((row.years === undefined || row.years === null) && d.years) {
      row.years = d.years;
      filled++;
    }
    if (row.access === undefined || row.access === null || row.access === "unknown") {
      if (d.access) {
        row.access = d.access;
        filled++;
      } else if (row.access == null) {
        row.access = "unknown";
        filled++;
      }
    }
  }
  for (const row of entry.record_types) {
    if (row && typeof row === "object" && row.access == null) row.access = "unknown";
  }
  return filled;
}
