/**
 * Payload extraction helpers for the qualifier probe — the parser layer.
 *
 * These live in their own module for one reason: they must be testable against
 * captured ground truth. `probe-search-qualifiers.ts` calls `main()` at the top
 * level, so importing it from a test would fire live API traffic; nothing in it
 * could be asserted without this split.
 *
 * That matters because every wrong headline this probe has produced came from
 * HERE rather than from the measurement logic, and each failure was silent and
 * one-directional — it manufactured absence, which then read as a finding:
 *
 *   - `yearOf` read `date.original` only. A burial indexed `original: "5"`,
 *     `formal: "+1505"` scored year-SILENT. It cannot invent a date, only lose
 *     one, so every year-silence count it fed was inflated.
 *   - The record walk never visited `relationships[].facts[]`, which is where a
 *     marriage date actually lives. Marriage then looked structurally
 *     date-less, and an "is any row genuinely in range?" control returned a
 *     false zero because the one in-range marriage was invisible to it.
 *   - An earlier `givenOf` read `names[].given`, which does not exist in this
 *     payload. Every relative became nameless, and the section reading it
 *     reported ZERO conflicts — a vacuous pass that looked like a clean result.
 *
 * Assertions live in `tests/dev/payload-extract.test.ts` against real captured
 * payloads. Change nothing here without changing the fixture.
 */

/** A GEDCOM X date object; every field is optional in real payloads. */
export interface GxDate {
  original?: unknown;
  formal?: unknown;
  normalized?: Array<{ value?: unknown }>;
}

export interface GxFact {
  type?: string;
  date?: unknown;
}

export interface GxPerson {
  id?: string;
  facts?: GxFact[];
  display?: Record<string, unknown>;
  names?: Array<{
    nameForms?: Array<{ parts?: Array<{ type?: string; value?: string }> }>;
  }>;
}

export interface GxRelationship {
  type?: string;
  facts?: GxFact[];
  person1?: { resourceId?: string };
  person2?: { resourceId?: string };
}

export interface Gedcomx {
  persons?: GxPerson[];
  relationships?: GxRelationship[];
}

/** One dated thing found on a record. */
export interface DatedEntry {
  /** Index into `persons`, or -1 for a record-level (relationship) fact. */
  personIdx: number;
  /** Fact-type URI tail (`Birth`, `Marriage`), or the `display` key. */
  kind: string;
  original: string;
  year: number | null;
}

/** First 4-digit year in a string, 1000-2099. */
export function yearOf(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/\b(1[0-9]\d{2}|20\d{2})\b/);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * A year from a date OBJECT, trying `original`, then `formal`, then
 * `normalized[].value`.
 *
 * Order matters and `original` goes first deliberately: when a record carries
 * a real year in `original` that is what a human indexed, and `formal` is a
 * derived normalisation of it. The fallbacks exist because parish registers
 * routinely put only the day in `original` ("5", "20") and the full date in
 * `formal` ("+1505", "+1520").
 */
export function yearOfDate(date: unknown): number | null {
  if (!date || typeof date !== "object") return null;
  const d = date as GxDate;
  const candidates: string[] = [];
  if (typeof d.original === "string") candidates.push(d.original);
  if (typeof d.formal === "string") candidates.push(d.formal);
  for (const n of d.normalized ?? []) {
    if (typeof n?.value === "string") candidates.push(n.value);
  }
  for (const c of candidates) {
    const y = yearOf(c);
    if (y !== null) return y;
  }
  return null;
}

/**
 * Every dated thing on a record: typed facts and `*Date` display keys for each
 * person, plus relationship-level facts.
 *
 * Relationship facts carry `personIdx: -1` because they belong to the record
 * rather than to any persona — a persona-vs-record silence split must not
 * charge them to `persons[0]`.
 */
export function datedFromGedcomx(gx: Gedcomx | undefined | null): DatedEntry[] {
  const persons = gx?.persons ?? [];
  const rels = gx?.relationships ?? [];
  const out: DatedEntry[] = [];

  persons.forEach((per, personIdx) => {
    for (const f of per.facts ?? []) {
      out.push({
        personIdx,
        kind: (f.type ?? "").split("/").pop() ?? "",
        original: ((f.date ?? {}) as GxDate).original as string ?? "",
        year: yearOfDate(f.date),
      });
    }
    for (const [kind, value] of Object.entries(per.display ?? {})) {
      if (!/Date$/.test(kind) || typeof value !== "string") continue;
      out.push({ personIdx, kind, original: value, year: yearOf(value) });
    }
  });

  for (const r of rels) {
    for (const f of r.facts ?? []) {
      out.push({
        personIdx: -1,
        kind: (f.type ?? "").split("/").pop() ?? "",
        original: ((f.date ?? {}) as GxDate).original as string ?? "",
        year: yearOfDate(f.date),
      });
    }
  }

  return out;
}

/**
 * A person's given name.
 *
 * It is NOT `names[].given` — that field does not exist here. The real shape is
 * `names[].nameForms[].parts[]` with `type` ending `/Given`.
 */
export function givenOf(per: GxPerson | undefined): string | null {
  for (const n of per?.names ?? []) {
    for (const nf of n.nameForms ?? []) {
      for (const part of nf.parts ?? []) {
        if (part.type?.endsWith("/Given") && part.value) return part.value;
      }
    }
  }
  return null;
}

/**
 * Years of one event family carried anywhere on the record.
 *
 * `kind` is matched against fact-type tails AND display keys, so a caller
 * passes e.g. `/^(Death|Burial|Cremation|deathDate)$/i`.
 */
export function familyYears(dated: DatedEntry[], kind: RegExp): number[] {
  return dated
    .filter((d) => kind.test(d.kind) && d.year !== null)
    .map((d) => d.year as number);
}

/**
 * Three-way, never two-way.
 *
 * A row that carries no date of the family is SILENT. A row dated outside the
 * window is FUZZ — the range reached past its own bounds. Collapsing fuzz into
 * silence is what let a birth "calibration" of 70 rows, every one of them
 * dated and none in range, certify that a range "tolerates silence".
 */
export function classifyAgainstWindow(
  dated: DatedEntry[],
  kind: RegExp,
  from: number,
  to: number
): "in-range" | "fuzz" | "silent" {
  const ys = familyYears(dated, kind);
  if (!ys.length) return "silent";
  return ys.some((y) => y >= from && y <= to) ? "in-range" : "fuzz";
}
