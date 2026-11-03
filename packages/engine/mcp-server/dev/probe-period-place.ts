/**
 * Probe: do a place's PERIOD and MODERN standard names select different record
 * sets in `record_search`?
 *
 * A FamilySearch place has a representation per era ("Rieti, Perugia, Umbria,
 * Italy" 1882-1923, "Rieti, Rieti, Lazio, Italy" from 1927). The locality guide
 * hands the agent the representation in force at the record's date, but an
 * index may have standardized the event place to another one, so the careful
 * search can be the one that misses the record. This measures whether that
 * happens, and what shape it takes, before anything in the tool changes.
 *
 *   npx tsx dev/probe-period-place.ts [caseId ...] [--max <n>]
 *
 * Each case runs `record_search` (the tool, under LOCAL) with one surname,
 * collection, record type and event year, under five place inputs: the period
 * standard name, the modern one, the parent jurisdiction of each, and no place.
 * Every place input runs with and without the event's `*PlaceExact`, and the
 * whole block runs twice: with the year unqualified, as the agent searches, and
 * with `*YearExact`. Unqualified, a year also admits records whose ESTIMATED
 * dates overlap it, so that set mixes in other eras, whose period name differs;
 * only the year-exact set holds the records the period name is right for.
 * Every page is read (100 per call) up to `--max` ids per input (default 1000),
 * so the sets are compared whole, not by their totals.
 *
 * Live, authenticated FamilySearch calls, one per page, each retried twice on a
 * failure: log in first (`make e2e-login`, or `eval\Login.bat` on Windows). A
 * set that comes back incomplete (a page still failing after its retries, or
 * fewer distinct records than its total) marks the case INCOMPLETE and the run's
 * exit code 1, unless the set was capped: a capped set's relations are not
 * measured anyway. Run one case to check a single figure; the default runs all
 * of them.
 *
 * WHAT THIS PROBE ESTABLISHES AND WHAT IT DOES NOT.
 * For each case it prints `totalMatches` and the collected set per input, whether
 * the case's target record is in it, and how the period set relates to the
 * modern one and to the no-place set (equal, subset, superset, disjoint or
 * neither), with up to 20 ids on each side of a difference, each with its role,
 * its record and the place text it carries.
 * A capped or failed set prints NOT MEASURED, never a direction. It does not say
 * which representation FamilySearch standardized each record to: the event
 * place a result carries is the record's own text, not the representation the
 * index matched on.
 */
import { LOCAL } from "../src/auth/principal.js";
import { recordSearchTool } from "../src/tools/record-search.js";
import type { RecordSearchInput } from "../src/types/record-search.js";
import { withRetry } from "../src/utils/place-resolver.js";

type Event = "birth" | "death" | "marriage";

interface Case {
  id: string;
  label: string;
  collectionId: string;
  recordType: NonNullable<RecordSearchInput["recordType"]>;
  surname: string;
  event: Event;
  year: number;
  /** A record of the place in that year: which sets hold it is the case's question. */
  target: string;
  period: string;
  modern: string;
  periodParent: string;
  modernParent: string;
  /** Most ids read per input, below `--max`: a case whose fuzzy sets are too big to read whole. */
  max?: number;
}

const CASES: Case[] = [
  {
    id: "rieti",
    label: "Rieti: province moved from Perugia (Umbria) to Rieti (Lazio) in 1927",
    collectionId: "2146202",
    recordType: "death",
    surname: "Marchetti",
    event: "death",
    year: 1913,
    target: "ark:/61903/1:1:Q2HC-CWMP",
    period: "Rieti, Perugia, Umbria, Italy",
    modern: "Rieti, Rieti, Lazio, Italy",
    periodParent: "Perugia, Umbria, Italy",
    modernParent: "Rieti, Lazio, Italy",
  },
  {
    id: "orvieto",
    label: "Orvieto: province of Perugia 1882-1927, then the new province of Terni, same region",
    collectionId: "2043538",
    recordType: "death",
    surname: "Mancini",
    event: "death",
    year: 1895,
    // Giuseppe Mancini, d. 14 Jan 1895, indexed "Terni, Umbria, Italia". The
    // same death is indexed a second time, as 78VB-CYMM, "Orvieto, Perugia, Umbria, Italia".
    target: "ark:/61903/1:1:QP8Z-23J8",
    period: "Orvieto, Perugia, Umbria, Italy",
    modern: "Orvieto, Terni, Umbria, Italy",
    periodParent: "Perugia, Umbria, Italy",
    modernParent: "Terni, Umbria, Italy",
  },
  {
    id: "denver",
    label: "Denver: in Arapahoe County to 1901, its own city and county from 1902",
    collectionId: "1932434",
    recordType: "marriage",
    surname: "Smith",
    event: "marriage",
    year: 1895,
    target: "ark:/61903/1:1:KNQW-5GS",
    period: "Denver, Arapahoe, Colorado, United States",
    modern: "Denver, Colorado, United States",
    periodParent: "Arapahoe, Colorado, United States",
    modernParent: "Colorado, United States",
  },
  {
    id: "echapora",
    label: "Place 6283855: \"Bela Vista\" 1938-1944, renamed \"Echaporã\" in 1944",
    collectionId: "2765317",
    recordType: "birth",
    surname: "Silva",
    event: "birth",
    year: 1940,
    // Its own text reads "Bela Vista, São Paulo, Brasil".
    target: "ark:/61903/1:1:78K9-CWW2",
    period: "Bela Vista, São Paulo, Brazil",
    modern: "Echaporã, São Paulo, Brazil",
    periodParent: "São Paulo, Brazil",
    modernParent: "São Paulo, Brazil",
    // Enough for the year-exact sets. Unqualified, the year admits most of the
    // state's Silva births; reading them whole adds nothing those sets do not show.
    max: 600,
  },
];

/** The event types a case's place text is read from, by the case's event family. */
const FAMILY: Record<Event, RegExp> = {
  birth: /Birth|Christening|Baptism/,
  death: /Death|Burial|Cremation/,
  marriage: /Marriage|Engagement/,
};

const INPUTS = ["period", "modern", "periodParent", "modernParent", "none"] as const;
type InputKey = (typeof INPUTS)[number];

interface Row {
  input: InputKey;
  place: string | null;
  exact: boolean;
  yearExact: boolean;
  total: number;
  ids: Set<string>;
  /** Role, record and place text per id, printed beside a difference. */
  info: Map<string, string>;
  truncated: boolean;
  targetAt: number | null;
  /** Set when a page still failed after its retries: the set is incomplete. */
  error?: string;
}

/** One page, retried: the tool throws on a timeout, which is not an empty result. */
function page(input: RecordSearchInput) {
  return withRetry(() => recordSearchTool(input, LOCAL), { attempts: 3, baseMs: 5000 });
}

function args(): { ids: string[]; max: number } {
  const argv = process.argv.slice(2);
  const ids: string[] = [];
  let max = 1000;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max") {
      max = Number(argv[++i]);
      // The last page read starts below `max` and must end by 4999, FamilySearch's paging limit.
      if (!Number.isInteger(max) || max < 100 || max > 4900) {
        throw new Error("--max must be an integer from 100 to 4900");
      }
    } else ids.push(argv[i]);
  }
  const unknown = ids.filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length) {
    throw new Error(`unknown case(s): ${unknown.join(", ")}; cases are ${CASES.map((c) => c.id).join(", ")}`);
  }
  return { ids, max };
}

function query(c: Case, place: string | null, exact: boolean, yearExact: boolean): RecordSearchInput {
  const input: Record<string, unknown> = {
    surname: c.surname,
    collectionId: c.collectionId,
    recordType: c.recordType,
    [`${c.event}YearFrom`]: c.year,
    [`${c.event}YearTo`]: c.year,
  };
  if (yearExact) input[`${c.event}YearExact`] = true;
  if (place !== null) {
    input[`${c.event}Place`] = place;
    if (exact) input[`${c.event}PlaceExact`] = true;
  }
  return input as RecordSearchInput;
}

async function collect(
  c: Case,
  input: InputKey,
  exact: boolean,
  yearExact: boolean,
  max: number,
): Promise<Row> {
  const place = input === "none" ? null : c[input];
  const ids = new Set<string>();
  const info = new Map<string, string>();
  let total = 0;
  let targetAt: number | null = null;
  let seen = 0;
  for (let offset = 0; ; offset += 100) {
    let response;
    try {
      response = await page({ ...query(c, place, exact, yearExact), count: 100, offset });
    } catch (err) {
      const error = err instanceof Error ? err.message.slice(0, 120) : String(err);
      return { input, place, exact, yearExact, total, ids, info, truncated: total > max, targetAt, error };
    }
    total = response.totalMatches;
    const results = response.results ?? [];
    for (const r of results) {
      if (targetAt === null && c.target && r.recordId === c.target) targetAt = seen + 1;
      ids.add(r.recordId);
      const own = c.event === "death" ? r.deathPlace : c.event === "birth" ? r.birthPlace : undefined;
      const event = r.events?.find((e) => e.place && FAMILY[c.event].test(e.type));
      const text = own ?? event?.place ?? `(no ${c.event} place text)`;
      info.set(r.recordId, `${r.role ?? "?"}, record ${r.recordArk ?? "?"}, ${text}`);
      seen++;
    }
    if (results.length === 0 || offset + 100 >= Math.min(total, max)) break;
  }
  const truncated = total > max;
  // A page repeating an earlier record, or coming back short, leaves the set
  // smaller than the total says: comparing it would report a wrong relation.
  if (!truncated && ids.size < total) {
    const error = `read ${ids.size} distinct records of the ${total} reported`;
    return { input, place, exact, yearExact, total, ids, info, truncated, targetAt, error };
  }
  return { input, place, exact, yearExact, total, ids, info, truncated, targetAt };
}

/** Ids in `a` and not in `b`, up to 20, each with its role, record and place text. */
function onlyIn(a: Row, b: Row): string[] {
  const ids = [...a.ids].filter((id) => !b.ids.has(id));
  const shown = ids.slice(0, 20).map((id) => `${id}  ${a.info.get(id)}`);
  return ids.length > 20 ? [...shown, `and ${ids.length - 20} more`] : shown;
}

/** How set `a` relates to set `b`, named from `a`'s side. Not measured when either was capped. */
function relation(a: Row, b: Row): string {
  if (a.error || b.error) return "NOT MEASURED (a search failed)";
  if (a.truncated || b.truncated) return "NOT MEASURED (a set was capped)";
  let both = 0;
  for (const id of a.ids) if (b.ids.has(id)) both++;
  const sizes = `${a.ids.size} and ${b.ids.size}, ${both} shared`;
  if (a.ids.size === 0 && b.ids.size === 0) return "both empty";
  if (a.ids.size === 0) return `empty (the other holds ${b.ids.size})`;
  if (b.ids.size === 0) return `the other is empty (this holds ${a.ids.size})`;
  if (both === a.ids.size && both === b.ids.size) return `equal (${sizes})`;
  if (both === 0) return `disjoint (${sizes})`;
  if (both === a.ids.size) return `subset of it (${sizes})`;
  if (both === b.ids.size) return `superset of it (${sizes})`;
  return `neither (${sizes})`;
}

const { ids, max } = args();
const cases = ids.length ? CASES.filter((c) => ids.includes(c.id)) : CASES;
const measured = new Date().toISOString().slice(0, 10);

for (const c of cases) {
  console.log(`\n${"=".repeat(78)}\n${c.id}: ${c.label}`);
  console.log(
    `collection ${c.collectionId}, ${c.recordType}, surname ${c.surname}, ${c.event} year ${c.year}` +
      (c.target ? `, target ${c.target}` : ", no target"),
  );
  let failed = false;
  for (const yearExact of [false, true]) {
    console.log(
      yearExact
        ? `\n  ${c.event}YearExact: only records whose indexed date is in ${c.year}`
        : `\n  year unqualified (as the agent searches): estimated dates that overlap ${c.year} count too`,
    );
    const rows: Row[] = [];
    for (const input of INPUTS) {
      for (const exact of input === "none" ? [false] : [false, true]) {
        const row = await collect(c, input, exact, yearExact, Math.min(c.max ?? max, max));
        rows.push(row);
        if (row.error && !row.truncated) failed = true;
        const target = !c.target
          ? ""
          : row.targetAt !== null
            ? `  target at ${row.targetAt}`
            : row.truncated || row.error
              ? `  target not in the ${row.ids.size} read`
              : "  target absent";
        console.log(
          `    ${input.padEnd(12)} ${exact ? "exact" : "     "}  total ${String(row.total).padStart(5)}` +
            `  read ${String(row.ids.size).padStart(4)}${row.truncated ? " (capped)" : ""}${target}` +
            `   ${row.place ?? "(no place)"}` +
            (row.error ? `\n      ERROR, set incomplete: ${row.error}` : ""),
        );
      }
    }
    const get = (input: InputKey, exact: boolean) => rows.find((r) => r.input === input && r.exact === exact)!;
    const none = get("none", false);
    console.log("    relations, named from the first set's side:");
    for (const exact of [false, true]) {
      const tag = exact ? "exact" : "     ";
      const period = get("period", exact);
      const modern = get("modern", exact);
      console.log(`      ${tag}  period to modern : ${relation(period, modern)}`);
      console.log(`      ${tag}  period to none   : ${relation(period, none)}`);
      console.log(`      ${tag}  modern to none   : ${relation(modern, none)}`);
      if (!period.truncated && !modern.truncated && !period.error && !modern.error) {
        const lost = onlyIn(modern, period);
        const extra = onlyIn(period, modern);
        if (lost.length) console.log(`               modern, not period:\n                 ${lost.join("\n                 ")}`);
        if (extra.length) console.log(`               period, not modern:\n                 ${extra.join("\n                 ")}`);
      }
    }
  }
  console.log(
    failed
      ? `\n  INCOMPLETE: a set came back incomplete; re-run npx tsx dev/probe-period-place.ts ${c.id}`
      : `\n  measured ${measured}, npx tsx dev/probe-period-place.ts ${c.id}`,
  );
  if (failed) process.exitCode = 1;
}
