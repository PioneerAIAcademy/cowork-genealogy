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
 * writes the answer as the tool returned it, which is already shaped by
 * `shapeAnswer`. `--from <file>` re-measures a saved answer with no login and no
 * network, as it stands; `--from <file> --shape` first puts it through
 * `shapeAnswer`, which is how the "after" column of the spec's Answer-size table
 * is regenerated from an answer saved before the shaping existed.
 *
 * The size is `JSON.stringify(result).length`: `server.ts` serializes a tool
 * result compact, and the CLI saves any result over `CLI_SPILL_CHARS` to a file
 * the agent may not be able to read back. The exit status is 1 when the answer
 * is over ANSWER_CHAR_BUDGET (so also when it is over the spill line), and when
 * the per-field table does not add up to the answer. The table is built from the
 * answer's structure: every brace, bracket and comma counted from the number of
 * keys and items it separates, and every `"key":value` from the JSON of its two
 * halves, then compared with `JSON.stringify` of the whole at each level (answer,
 * hit list, hit, film-note list, film note). A miscounted table fails the run.
 *
 * The tool fits an answer into ANSWER_CHAR_BUDGET: a hit whose film notes were
 * cut shows `listed/total` in the filmNotes column and prints its hint, and an
 * answer that left hits off its end prints the count and the hint, which is the
 * live check that the answer is bounded (a unit test only pins fixtures).
 *
 * Requires a prior `login` so ~/.familysearch-mcp/tokens.json exists, except
 * with `--from`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { LOCAL } from "../src/auth/principal.js";
import { ANSWER_CHAR_BUDGET, catalogSearchTool, shapeAnswer } from "../src/tools/catalog-search.js";
import type {
  CatalogHit,
  CatalogSearchInput,
  CatalogSearchResult,
} from "../src/types/catalog-search.js";
import { CLI_SPILL_CHARS } from "../tests/helpers/cli-spill.js";

const USAGE =
  "usage: npx tsx dev/try-catalog-search.ts [place] [keywords] [--count N] [--hydrate N] [--save FILE]\n" +
  "       npx tsx dev/try-catalog-search.ts --from FILE [--shape]";

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
  from?: string;
  shape: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let shape = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const name = a.slice(2);
    if (name === "shape") {
      shape = true;
      continue;
    }
    if (name !== "count" && name !== "hydrate" && name !== "save" && name !== "from") {
      die(`unknown flag ${a}`);
    }
    const value = argv[++i];
    // An empty value is not a value: `--from "$UNSET"` would otherwise run a live
    // authenticated search where an offline re-measure was meant.
    if (value === undefined || value === "" || value.startsWith("--")) die(`${a} needs a value`);
    flags[name] = value;
  }
  if (positional.length > 2) die("at most two positional arguments: place and keywords");
  // A saved answer already holds its query and its counts: any of these beside
  // --from would be silently ignored, which reads as "measured with them".
  if (flags.from !== undefined && (positional.length > 0 || Object.keys(flags).length > 1)) {
    die("--from takes a file, and --shape, and nothing else");
  }
  // A live answer was shaped by the tool already; shaping it again measures nothing new.
  if (shape && flags.from === undefined) die("--shape applies to --from: a live answer is already shaped");
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
    from: flags.from,
    shape,
  };
}

/** Characters of a value in the compact form the server sends. */
const chars = (v: unknown): number => JSON.stringify(v)?.length ?? 0;

/** Characters `"key":value` takes inside a compact object. */
const pair = (key: string, value: unknown): number => chars(key) + 1 + chars(value);

/** The braces or brackets of a compact object or array of `n` members, and the commas between them. */
const frame = (n: number): number => 2 + Math.max(0, n - 1);

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
  let r: CatalogSearchResult;
  if (args.from !== undefined) {
    r = JSON.parse(readFileSync(args.from, "utf-8")) as CatalogSearchResult;
    if (r === null || typeof r !== "object" || !Array.isArray(r.hits)) {
      die(`${args.from} is not a catalog_search answer: it has no hits (${JSON.stringify(r).slice(0, 120)})`);
    }
    if (args.shape) shapeAnswer(r);
  } else {
    r = await catalogSearchTool(input, LOCAL);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const total = chars(r);
  const hydrated = r.hits.filter((h) => h.hydrated);
  console.log(
    args.from !== undefined
      ? `answer read from ${args.from}${args.shape ? ", put through shapeAnswer" : ", as saved"}`
      : `input sent: ${JSON.stringify(input)}`,
  );
  console.log(
    `${args.from !== undefined ? "saved answer" : args.place} -> ${r.totalHits} hits, ${r.returned} returned, ${hydrated.length} hydrated ` +
      `(hydrateRequested=${r.hydrateRequested}), placeResolved=${r.placeResolved}, ` +
      `hydrationTimedOut=${r.hydrationTimedOut}${args.from !== undefined ? "" : `, ${seconds}s`}`,
  );
  const verdict =
    total > CLI_SPILL_CHARS
      ? `OVER the spill line by ${fmt(total - CLI_SPILL_CHARS)}`
      : `under the spill line by ${fmt(CLI_SPILL_CHARS - total)}`;
  console.log(`\nJSON.stringify(result).length = ${fmt(total)}  (spill line ${fmt(CLI_SPILL_CHARS)}: ${verdict})`);

  // ---- per hit -------------------------------------------------------------
  console.log(
    "\nper hit (chars of the hit object; filmNotes = entries listed, or listed/total when the tool cut the list)",
  );
  console.log("   #  hydrated   chars  filmNotes  notes  id / title");
  r.hits.forEach((h, i) => {
    const listed = `${h.filmNotes?.length ?? 0}${h.filmNotesTotal !== undefined ? `/${h.filmNotesTotal}` : ""}`;
    console.log(
      `${String(i + 1).padStart(4)}  ${String(h.hydrated).padEnd(8)} ${col(chars(h), 7)}` +
        `${listed.padStart(10)}${String(h.notes?.length ?? 0).padStart(7)}  ` +
        `${h.id ?? "(none)"}  ${h.title.slice(0, 60)}`,
    );
  });
  const cut = r.hits.filter((h) => h.filmNotesTotal !== undefined);
  console.log(
    `\nbudget ${fmt(ANSWER_CHAR_BUDGET)}: answer is ${fmt(total)}` +
      (total <= ANSWER_CHAR_BUDGET ? " (within it)" : " (OVER it)") +
      `; film notes cut on ${cut.length} of ${r.hits.length} hits, every hit listed: ${r.hitsOmitted === undefined}`,
  );
  if (r.hitsOmitted !== undefined) {
    console.log(`hits left off the end: ${fmt(r.hitsOmitted)} (${fmt(r.hits.length)} listed); hint: ${r.hitsOmittedHint}`);
  }
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
  // Everything below is counted from the answer's structure, not subtracted from
  // its size: a brace, bracket or comma is counted from the number of keys or
  // items it separates, a `"key":value` from the JSON of its two halves. The sums
  // are then compared with `JSON.stringify` of the whole at every level, so a
  // wrong count shows up instead of being absorbed by a leftover.
  const topFields = new Map<string, FieldTotal>();
  const noteFields = new Map<string, FieldTotal>();
  let hitFrames = 0; // braces and commas inside every hit
  let notesFrames = 0; // brackets and commas around every filmNotes list
  let noteFrames = 0; // braces and commas inside every film note
  let noteCount = 0;
  const mismatches: string[] = [];
  const level = (what: string, counted: number, measured: number): void => {
    if (counted !== measured) mismatches.push(`${what}: counted ${fmt(counted)}, JSON.stringify gives ${fmt(measured)}`);
  };
  for (const [i, h] of r.hits.entries()) {
    const fields = entriesOf(h);
    for (const [k, v] of fields) bump(topFields, k, pair(k, v));
    hitFrames += frame(fields.length);
    level(`hit ${i + 1}`, frame(fields.length) + fields.reduce((a, [k, v]) => a + pair(k, v), 0), chars(h));
    const notes = h.filmNotes;
    if (!notes) continue;
    notesFrames += frame(notes.length);
    level(`hit ${i + 1} filmNotes`, frame(notes.length) + notes.reduce((a, n) => a + chars(n), 0), chars(notes));
    for (const n of notes) {
      noteCount++;
      const parts = entriesOf(n);
      noteFrames += frame(parts.length);
      for (const [k, v] of parts) bump(noteFields, k, pair(k, v));
      level(`hit ${i + 1} film note`, frame(parts.length) + parts.reduce((a, [k, v]) => a + pair(k, v), 0), chars(n));
    }
  }
  level("hits[]", frame(r.hits.length) + r.hits.reduce((a, h) => a + chars(h), 0), chars(r.hits));
  // Outside hits[]: the answer's own braces and commas, every other key, and `"hits":`.
  const top = entriesOf(r);
  const envelope =
    frame(top.length) + top.filter(([k]) => k !== "hits").reduce((a, [k, v]) => a + pair(k, v), 0) + chars("hits") + 1;
  const arrayFrame = frame(r.hits.length);

  console.log("\nper-field totals across all hits (chars of `\"key\":value`, % of the whole answer)");
  console.log(`  envelope (everything outside hits[])   ${col(envelope)} ${pct(envelope, total)}`);
  console.log(`  hits[] brackets and commas             ${col(arrayFrame)} ${pct(arrayFrame, total)}`);
  console.log(`  braces and commas inside the ${String(r.hits.length).padStart(3)} hits ${col(hitFrames)} ${pct(hitFrames, total)}`);
  printFields("hit fields", topFields, total, "  ");

  const filmNotesChars = topFields.get("filmNotes")?.chars ?? 0;
  // The `"filmNotes":` key is written once in every hit that carries the list.
  const filmNotesKeys = (chars("filmNotes") + 1) * (topFields.get("filmNotes")?.seen ?? 0);
  console.log(
    `\nfilmNotes breakdown (${fmt(noteCount)} film notes; filmNotes is ${fmt(filmNotesChars)} chars, ${pct(filmNotesChars, total).trim()} of the answer)`,
  );
  console.log(`  "filmNotes": keys                      ${col(filmNotesKeys)} ${pct(filmNotesKeys, total)}`);
  console.log(`  list brackets and commas               ${col(notesFrames)} ${pct(notesFrames, total)}`);
  console.log(`  braces and commas inside the ${String(noteCount).padStart(3)} notes ${col(noteFrames)} ${pct(noteFrames, total)}`);
  printFields("note fields", noteFields, total, "  ");

  const attributedTotal =
    envelope + arrayFrame + hitFrames + [...topFields.values()].reduce((a, t) => a + t.chars, 0);
  const noteAttributed =
    filmNotesKeys + notesFrames + noteFrames + [...noteFields.values()].reduce((a, t) => a + t.chars, 0);
  level("answer", attributedTotal, total);
  level("filmNotes field", noteAttributed, filmNotesChars);
  console.log(
    `\nreconciliation: envelope + hit fields + frames = ${fmt(attributedTotal)} of ${fmt(total)} ` +
      `-> ${fmt(total - attributedTotal)} unattributed; ` +
      `filmNotes parts = ${fmt(noteAttributed)} of ${fmt(filmNotesChars)} -> ${fmt(filmNotesChars - noteAttributed)} unattributed`,
  );
  if (mismatches.length > 0) {
    console.error(`RECONCILIATION FAILED: the table does not add up to the answer.\n  ${mismatches.slice(0, 5).join("\n  ")}`);
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
    if (h.filmNotesHint) console.log(`    hint: ${h.filmNotesHint}`);
    if (h.digitalLibraryUrl) console.log(`    book: ${h.digitalLibraryUrl}`);
  }

  // The answer is what the tool is run to check, so it is on screen before anything
  // below can fail, and the saved file is what was printed.
  if (args.save !== undefined) {
    writeFileSync(args.save, JSON.stringify(r), "utf-8");
    console.log(`\nsaved the answer, as the tool returned it, to ${args.save}`);
  }

  // A check that cannot fail reads as coverage: an answer over the budget (so, past the
  // spill line too, when it is that big) is a failed run.
  if (total > ANSWER_CHAR_BUDGET) {
    console.error(
      `OVER THE BUDGET: the answer is ${fmt(total)} characters, ${fmt(total - ANSWER_CHAR_BUDGET)} over ${fmt(ANSWER_CHAR_BUDGET)}` +
        (total > CLI_SPILL_CHARS ? `, and ${fmt(total - CLI_SPILL_CHARS)} over the ${fmt(CLI_SPILL_CHARS)} spill line` : ""),
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
