/**
 * Probe — evidence trail behind issue #2554: does `totalMatches` from
 * `record_search` (src/tools/record-search.ts) discriminate a COMMON name
 * from a RARE one, and does fuzzy name matching quietly fold a plausible
 * MIS-INDEXING of the rare name into the same low-count bucket — which would
 * make `totalMatches` alone an unreliable commonality signal?
 *
 * Three legs, the same shape (surname + givenName + birthPlace + a ~10-year
 * birthYearFrom/birthYearTo range), each run under four increasingly strict
 * flag settings:
 *
 *   LEG common     — Patrick Flynn, County Cork Ireland, 1850-1860. A stock
 *                     common-name/common-place combination.
 *   LEG rare       — Alonzo Wigglesworth, Schuylkill County PA, 1845-1855. An
 *                     uncommon given name paired with an uncommon surname.
 *   LEG misindexed — Alorze Wigglesworth, same place/years as LEG rare.
 *                     "Alorze" is a plausible OCR/handwriting misreading of
 *                     "Alonzo" — this leg asks whether fuzzy matching quietly
 *                     treats a misspelling of a rare name as just as rare
 *                     (folds it into the same low-count bucket), which would
 *                     make a low totalMatches ambiguous between "this name is
 *                     genuinely rare" and "this name is mis-indexed".
 *
 *   SETTING 1 — all fuzzy: no `*Exact` flag at all.
 *   SETTING 2 — `surnameExact: true` only.
 *   SETTING 3 — SETTING 2 + `givenNameExact: true`.
 *   SETTING 4 — SETTING 3 + `birthPlaceExact: true`.
 *
 * Calls `recordSearchTool` (src/tools/record-search.ts) directly — the same
 * function the `record_search` MCP tool dispatches to — with `count: 1` on
 * every call: only `totalMatches` (FamilySearch's own upstream total,
 * independent of page size) is read, never `results`.
 *
 * EVERY VERDICT LINE IS COMPUTED FROM THE RUN, never a literal — same rule as
 * dev/probe-search-qualifiers.ts (see the warning at the top of that file)
 * and dev/probe-batch-anchor.ts. A leg/setting combination that errors
 * reports NOT MEASURED and is dropped from every verdict's inputs — never
 * coerced to 0, which would silently misread "the request failed" as "zero
 * matches".
 *
 * The two verdicts share one threshold, `ORDER_OF_MAGNITUDE = 10`: common vs
 * rare are called SEPARATED when they differ by 10x or more under a setting;
 * mis-indexed vs rare are called SIMILAR (fuzzy folded them together) under
 * the same 10x boundary, just read the other way — under 10x apart counts as
 * similar. One named constant, used both ways, rather than two independently
 * chosen numbers.
 *
 * Run:  npx tsx dev/probe-name-commonality.ts
 * Needs a live FamilySearch token — run the `login` tool (or `make
 * e2e-login`) first. `getValidToken(LOCAL)` is called once up front purely to
 * fail fast with one clear message before 12 live search calls;
 * `recordSearchTool` re-checks it on every call regardless.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { recordSearchTool } from "../src/tools/record-search.js";
import type { RecordSearchInput } from "../src/types/record-search.js";

interface Leg {
  label: string;
  surname: string;
  givenName: string;
  birthPlace: string;
  birthYearFrom: number;
  birthYearTo: number;
}

const COMMON: Leg = {
  label: "common — Patrick Flynn",
  surname: "Flynn",
  givenName: "Patrick",
  birthPlace: "County Cork, Ireland",
  birthYearFrom: 1850,
  birthYearTo: 1860,
};

const RARE: Leg = {
  label: "rare — Alonzo Wigglesworth",
  surname: "Wigglesworth",
  givenName: "Alonzo",
  birthPlace: "Schuylkill, Pennsylvania, United States",
  birthYearFrom: 1845,
  birthYearTo: 1855,
};

const MISINDEXED: Leg = {
  label: "mis-indexed — Alorze Wigglesworth",
  surname: "Wigglesworth",
  givenName: "Alorze",
  birthPlace: "Schuylkill, Pennsylvania, United States",
  birthYearFrom: 1845,
  birthYearTo: 1855,
};

interface FlagSetting {
  label: string;
  surnameExact?: boolean;
  givenNameExact?: boolean;
  birthPlaceExact?: boolean;
}

const FLAG_SETTINGS: FlagSetting[] = [
  { label: "all fuzzy" },
  { label: "surnameExact", surnameExact: true },
  { label: "surnameExact+givenNameExact", surnameExact: true, givenNameExact: true },
  {
    label: "surnameExact+givenNameExact+birthPlaceExact",
    surnameExact: true,
    givenNameExact: true,
    birthPlaceExact: true,
  },
];

/** `totalMatches` from one call, or `null` (with `note`) when the call threw. */
interface Cell {
  total: number | null;
  note?: string;
}

// No project context needed — issue #2554 is about the raw upstream count.
// We only ever read `totalMatches`, never anything staged. `projectPath` still
// has to point somewhere real: passing "." (measured while writing this probe)
// makes `recordSearchTool` stage a live `results/.staging/*.json` file per
// call straight into the mcp-server source tree, since staging treats ANY
// existing directory as a project root rather than declining to write when
// one "looks like" a project. A fresh OS temp directory gets the same
// best-effort-safe behavior (record-search.ts: "a staging failure never fails
// a successful search") without leaving clutter in the repo. Set once in
// main(), before any call.
let PROJECT_PATH = "";

async function search(leg: Leg, flags: FlagSetting): Promise<Cell> {
  const input: RecordSearchInput = {
    surname: leg.surname,
    givenName: leg.givenName,
    birthPlace: leg.birthPlace,
    birthYearFrom: leg.birthYearFrom,
    birthYearTo: leg.birthYearTo,
    count: 1,
    projectPath: PROJECT_PATH,
    ...(flags.surnameExact ? { surnameExact: true } : {}),
    ...(flags.givenNameExact ? { givenNameExact: true } : {}),
    ...(flags.birthPlaceExact ? { birthPlaceExact: true } : {}),
  };
  try {
    const out = await recordSearchTool(input, LOCAL);
    return { total: out.totalMatches };
  } catch (err) {
    return { total: null, note: err instanceof Error ? err.message : String(err) };
  }
}

async function runLeg(leg: Leg): Promise<Cell[]> {
  const row: Cell[] = [];
  for (const flags of FLAG_SETTINGS) {
    row.push(await search(leg, flags));
  }
  return row;
}

const shortCell = (c: Cell): string => (c.total === null ? "ERROR" : c.total.toLocaleString("en-US"));

function printTable(rows: Array<{ leg: Leg; cells: Cell[] }>): void {
  const legColWidth = Math.max(...rows.map((r) => r.leg.label.length), "leg".length) + 2;
  const settingColWidths = FLAG_SETTINGS.map(
    (s, i) => Math.max(s.label.length, ...rows.map((r) => shortCell(r.cells[i]).length)) + 2,
  );

  console.log(
    "leg".padEnd(legColWidth) +
      FLAG_SETTINGS.map((s, i) => s.label.padEnd(settingColWidths[i])).join(""),
  );
  for (const { leg, cells } of rows) {
    console.log(
      leg.label.padEnd(legColWidth) +
        cells.map((c, i) => shortCell(c).padEnd(settingColWidths[i])).join(""),
    );
  }

  const errors: string[] = [];
  for (const { leg, cells } of rows) {
    cells.forEach((c, i) => {
      if (c.total === null) {
        errors.push(`${leg.label} / ${FLAG_SETTINGS[i].label}: ${c.note ?? "unknown error"}`);
      }
    });
  }
  if (errors.length > 0) {
    console.log("\nErrors (excluded from every verdict below):");
    for (const e of errors) console.log(`  ${e}`);
  }
}

/**
 * A symmetric >=1 ratio between two non-negative totals. `Infinity` when
 * exactly one side is 0 and the other is not (unboundedly separated); `1`
 * when both are 0 (no separation is measurable either way, and 1 is the
 * ratio's own identity value, not a guess).
 */
function magnitudeRatio(a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === 0) return hi === 0 ? 1 : Infinity;
  return hi / lo;
}

const ORDER_OF_MAGNITUDE = 10;

interface Comparison {
  label: string;
  left: Cell;
  right: Cell;
  ratio: number | null;
}

function compareRows(leftRow: Cell[], rightRow: Cell[]): Comparison[] {
  return FLAG_SETTINGS.map((flags, i) => {
    const left = leftRow[i];
    const right = rightRow[i];
    const ratio =
      left.total !== null && right.total !== null ? magnitudeRatio(left.total, right.total) : null;
    return { label: flags.label, left, right, ratio };
  });
}

function printComparison(title: string, comparisons: Comparison[]): void {
  console.log(`\n${title}`);
  for (const c of comparisons) {
    const ratioText =
      c.ratio === null ? "NOT MEASURED" : c.ratio === Infinity ? "infinite" : `${c.ratio.toFixed(1)}x`;
    console.log(`  [${c.label}] ${shortCell(c.left)} vs ${shortCell(c.right)} -> ratio ${ratioText}`);
  }
}

async function main(): Promise<void> {
  // Fail fast with one clear message before 12 live calls; recordSearchTool
  // re-checks this per call regardless (defense in depth, not redundant dead
  // code — see the header comment).
  await getValidToken(LOCAL);

  PROJECT_PATH = await mkdtemp(join(tmpdir(), "probe-name-commonality-"));

  const commonRow = await runLeg(COMMON);
  const rareRow = await runLeg(RARE);
  const misindexedRow = await runLeg(MISINDEXED);

  console.log("\nrecord_search totalMatches — issue #2554 name-commonality probe\n");
  printTable([
    { leg: COMMON, cells: commonRow },
    { leg: RARE, cells: rareRow },
    { leg: MISINDEXED, cells: misindexedRow },
  ]);

  // ---- Verdict 1: does totalMatches separate common from rare? ----------
  const commonVsRare = compareRows(commonRow, rareRow);
  printComparison("common vs rare (Flynn vs Wigglesworth)", commonVsRare);
  const separatedSettings = commonVsRare.filter(
    (c) => c.ratio !== null && c.ratio >= ORDER_OF_MAGNITUDE,
  );
  const commonVsRareMeasured = commonVsRare.some((c) => c.ratio !== null);
  console.log(
    !commonVsRareMeasured
      ? "  -> NOT MEASURED (every common/rare comparison errored)"
      : separatedSettings.length > 0
        ? `  -> ORDER OF MAGNITUDE SEPARATION (>=${ORDER_OF_MAGNITUDE}x under: ${separatedSettings
            .map((c) => c.label)
            .join(", ")})`
        : "  -> NO SEPARATION",
  );

  // ---- Verdict 2: does fuzzy matching count the mis-indexing as rare? ---
  const misVsRare = compareRows(misindexedRow, rareRow);
  printComparison("mis-indexed vs rare (Alorze vs Alonzo Wigglesworth)", misVsRare);
  const similarSettings = misVsRare.filter((c) => c.ratio !== null && c.ratio < ORDER_OF_MAGNITUDE);
  const misVsRareMeasured = misVsRare.some((c) => c.ratio !== null);
  console.log(
    !misVsRareMeasured
      ? "  -> NOT MEASURED (every mis-indexed/rare comparison errored)"
      : similarSettings.length > 0
        ? `  -> FUZZY COUNTS MIS-INDEXING AS RARE (within ${ORDER_OF_MAGNITUDE}x under: ${similarSettings
            .map((c) => c.label)
            .join(", ")})`
        : "  -> MIS-INDEXING SEPARATED",
  );
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
