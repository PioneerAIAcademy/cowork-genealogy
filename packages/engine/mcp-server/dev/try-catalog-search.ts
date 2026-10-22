/**
 * Live check for `catalog_search`, run at the tool's own defaults, that reports
 * how many characters the answer takes and where they go.
 *
 *   npx tsx dev/try-catalog-search.ts "Maine, United States"
 *   npx tsx dev/try-catalog-search.ts "Ireland" "Catholic parish registers baptism marriage"
 *   npx tsx dev/try-catalog-search.ts "Hammer, Hordaland, Norway" "kirkebøker"
 *   npx tsx dev/try-catalog-search.ts "Javorje nad Škofjo Loko, Slovenia"
 *
 * `count` and `hydrate` are sent ONLY when passed (`--count 8 --hydrate 4`), so
 * a bare run measures what an agent that gives a place gets. `--save <file>`
 * writes the raw answer for offline re-measurement.
 *
 * The size is `JSON.stringify(result).length`: `server.ts` serializes a tool
 * result compact, and the CLI saves any result over `CLI_SPILL_CHARS` to a file
 * the agent may not be able to read back. The per-field table charges every
 * field its `"key":value` text, and the printed reconciliation line must read
 * "0 unattributed", or the table does not add up to the answer it describes.
 *
 * Requires a prior `login` so ~/.familysearch-mcp/tokens.json exists.
 */
import { writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { catalogSearchTool } from "../src/tools/catalog-search.js";
import type { CatalogHit, CatalogSearchInput } from "../src/types/catalog-search.js";
import { CLI_SPILL_CHARS } from "../tests/helpers/cli-spill.js";

const USAGE =
  'usage: npx tsx dev/try-catalog-search.ts [place] [keywords] [--count N] [--hydrate N] [--save FILE]';

function die(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(1);
}

interface Args {
  place: string;
  keywords?: string;
  count?: number;
  hydrate?: number;
  save?: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (name !== "count" && name !== "hydrate" && name !== "save") die(`unknown flag ${a}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) die(`${a} needs a value`);
    flags[name] = value;
  }
  if (positional.length > 2) die("at most two positional arguments: place and keywords");
  const whole = (name: string): number | undefined => {
    const raw = flags[name];
    if (raw === undefined) return undefined;
    // Number("") is 0 and Number("8x") is NaN: both would reach the tool as a
    // value the caller never meant, so only a plain run of digits passes.
    if (!/^\d+$/.test(raw)) die(`--${name} must be a whole number, got "${raw}"`);
    return Number(raw);
  };
  return {
    place: positional[0] ?? "Maine, United States",
    ...(positional[1] !== undefined ? { keywords: positional[1] } : {}),
    count: whole("count"),
    hydrate: whole("hydrate"),
    save: flags.save,
  };
}

/** Characters of a value in the compact form the server sends. */
const chars = (v: unknown): number => JSON.stringify(v)?.length ?? 0;

/** Characters `"key":value` takes inside a compact object. */
const pair = (key: string, value: unknown): number => chars(key) + 1 + chars(value);

const fmt = (n: number): string => n.toLocaleString("en-US");
const col = (n: number, width = 9): string => fmt(n).padStart(width);
const pct = (n: number, whole: number): string =>
  `${whole === 0 ? "0.0" : ((100 * n) / whole).toFixed(1)}%`.padStart(6);

interface FieldTotal {
  chars: number;
  /** How many objects carry the field. */
  seen: number;
}

function bump(into: Map<string, FieldTotal>, key: string, n: number): void {
  const t = into.get(key) ?? { chars: 0, seen: 0 };
  t.chars += n;
  t.seen += 1;
  into.set(key, t);
}

/** Every entry of an object that JSON.stringify would keep. */
function entriesOf(o: object): [string, unknown][] {
  return Object.entries(o).filter(([, v]) => v !== undefined && typeof v !== "function");
}

function printFields(
  title: string,
  fields: Map<string, FieldTotal>,
  whole: number,
  indent: string,
): void {
  console.log(`${indent}${title}`);
  const rows = [...fields.entries()].sort((a, b) => b[1].chars - a[1].chars);
  for (const [name, t] of rows) {
    console.log(
      `${indent}  ${name.padEnd(20)}${col(t.chars)} ${pct(t.chars, whole)}   in ${fmt(t.seen)} objects`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input: CatalogSearchInput = {
    standardPlace: args.place,
    ...(args.keywords !== undefined ? { keywords: args.keywords } : {}),
    ...(args.count !== undefined ? { count: args.count } : {}),
    ...(args.hydrate !== undefined ? { hydrate: args.hydrate } : {}),
  };

  const started = Date.now();
  const r = await catalogSearchTool(input, LOCAL);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (args.save) writeFileSync(args.save, JSON.stringify(r), "utf-8");

  const total = chars(r);
  const hydrated = r.hits.filter((h) => h.hydrated);
  console.log(`input sent: ${JSON.stringify(input)}`);
  console.log(
    `${args.place} -> ${r.totalHits} hits, ${r.returned} returned, ${hydrated.length} hydrated ` +
      `(hydrateRequested=${r.hydrateRequested}), placeResolved=${r.placeResolved}, ` +
      `hydrationTimedOut=${r.hydrationTimedOut}, ${seconds}s`,
  );
  const verdict =
    total > CLI_SPILL_CHARS
      ? `OVER the spill line by ${fmt(total - CLI_SPILL_CHARS)}`
      : `under the spill line by ${fmt(CLI_SPILL_CHARS - total)}`;
  console.log(`\nJSON.stringify(result).length = ${fmt(total)}  (spill line ${fmt(CLI_SPILL_CHARS)}: ${verdict})`);

  // ---- per hit -------------------------------------------------------------
  console.log("\nper hit (chars of the hit object; filmNotes = how many film notes it carries)");
  console.log("   #  hydrated   chars  filmNotes  notes  id / title");
  r.hits.forEach((h, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(h.hydrated).padEnd(8)} ${col(chars(h), 7)}` +
        `${String(h.filmNotes?.length ?? 0).padStart(10)}${String(h.notes?.length ?? 0).padStart(7)}  ` +
        `${h.id ?? "(none)"}  ${h.title.slice(0, 60)}`,
    );
  });
  const group = (label: string, hs: CatalogHit[]): void => {
    if (hs.length === 0) return console.log(`${label}: none`);
    const sizes = hs.map((h) => chars(h));
    const sum = sizes.reduce((a, b) => a + b, 0);
    console.log(
      `${label}: ${hs.length} hits, ${fmt(sum)} chars, mean ${fmt(Math.round(sum / hs.length))}, ` +
        `max ${fmt(Math.max(...sizes))}`,
    );
  };
  console.log("");
  group("hydrated hits  ", hydrated);
  group("unhydrated hits", r.hits.filter((h) => !h.hydrated));

  // ---- per field -----------------------------------------------------------
  const topFields = new Map<string, FieldTotal>();
  const noteFields = new Map<string, FieldTotal>();
  let hitObjects = 0;
  let hitOverhead = 0; // braces and commas inside every hit
  let notesArrays = 0; // brackets and commas around every filmNotes list
  let noteObjects = 0; // chars of every film note object
  let noteOverhead = 0; // braces and commas inside every film note
  let noteCount = 0;
  for (const h of r.hits) {
    const hitChars = chars(h);
    hitObjects += hitChars;
    let attributed = 0;
    for (const [k, v] of entriesOf(h)) {
      bump(topFields, k, pair(k, v));
      attributed += pair(k, v);
    }
    hitOverhead += hitChars - attributed;
    for (const n of h.filmNotes ?? []) {
      noteCount++;
      const noteChars = chars(n);
      noteObjects += noteChars;
      let inNote = 0;
      for (const [k, v] of entriesOf(n)) {
        bump(noteFields, k, pair(k, v));
        inNote += pair(k, v);
      }
      noteOverhead += noteChars - inNote;
    }
    if (h.filmNotes) {
      notesArrays += chars(h.filmNotes) - h.filmNotes.reduce((a, n) => a + chars(n), 0);
    }
  }
  const hitsArray = chars(r.hits);
  const envelope = total - hitsArray;
  const arrayOverhead = hitsArray - hitObjects;

  console.log("\nper-field totals across all hits (chars of `\"key\":value`, % of the whole answer)");
  console.log(`  envelope (everything outside hits[])   ${col(envelope)} ${pct(envelope, total)}`);
  console.log(`  hits[] brackets and commas             ${col(arrayOverhead)} ${pct(arrayOverhead, total)}`);
  console.log(`  braces and commas inside the ${String(r.hits.length).padStart(3)} hits ${col(hitOverhead)} ${pct(hitOverhead, total)}`);
  printFields("hit fields", topFields, total, "  ");

  const filmNotesTotal = topFields.get("filmNotes")?.chars ?? 0;
  // The `"filmNotes":` key is written once in every hit that carries the list.
  const filmNotesKeys = (chars("filmNotes") + 1) * (topFields.get("filmNotes")?.seen ?? 0);
  console.log(
    `\nfilmNotes breakdown (${fmt(noteCount)} film notes; filmNotes is ${fmt(filmNotesTotal)} chars, ${pct(filmNotesTotal, total).trim()} of the answer)`,
  );
  console.log(`  "filmNotes": keys                      ${col(filmNotesKeys)} ${pct(filmNotesKeys, total)}`);
  console.log(`  list brackets and commas               ${col(notesArrays)} ${pct(notesArrays, total)}`);
  console.log(`  braces and commas inside the ${String(noteCount).padStart(3)} notes ${col(noteOverhead)} ${pct(noteOverhead, total)}`);
  printFields("note fields", noteFields, total, "  ");

  const attributedTotal =
    envelope + arrayOverhead + hitOverhead + [...topFields.values()].reduce((a, t) => a + t.chars, 0);
  const noteAttributed =
    filmNotesKeys +
    notesArrays +
    noteOverhead +
    [...noteFields.values()].reduce((a, t) => a + t.chars, 0);
  console.log(
    `\nreconciliation: envelope + hit fields + overhead = ${fmt(attributedTotal)} of ${fmt(total)} ` +
      `-> ${fmt(total - attributedTotal)} unattributed; ` +
      `filmNotes parts = ${fmt(noteAttributed)} of ${fmt(filmNotesTotal)} -> ${fmt(filmNotesTotal - noteAttributed)} unattributed`,
  );
  if (total !== attributedTotal || filmNotesTotal !== noteAttributed) {
    console.error("RECONCILIATION FAILED: the table does not add up to the answer.");
    process.exitCode = 1;
  }

  // ---- first hits, as before -----------------------------------------------
  for (const h of r.hits.slice(0, 3)) {
    console.log(`\n  ${h.title.slice(0, 72)}`);
    console.log(`    id=${h.id ?? "(none)"}  hydrated=${h.hydrated}`);
    if (h.repositoryCalls.length) console.log(`    access: ${h.repositoryCalls.join(", ")}`);
    for (const f of (h.filmNotes ?? []).slice(0, 2)) {
      console.log(
        `    film: filmNumber=${f.filmNumber ?? "-"} imageGroupNumber=${f.imageGroupNumber ?? "-"}` +
          (f.text ? ` "${f.text.slice(0, 44)}"` : ""),
      );
    }
    if (h.digitalLibraryUrl) console.log(`    book: ${h.digitalLibraryUrl}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
