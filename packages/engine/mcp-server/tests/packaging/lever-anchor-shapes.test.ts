import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateInput } from "../../src/tools/record-search.js";
import type { RecordSearchInput } from "../../src/types/record-search.js";

/**
 * Every concrete `record_search` parameter shape prescribed in
 * search-records/references/search-strategy-levers.md must actually satisfy
 * the shipped `validateInput` -- a reference file can prescribe a call the
 * tool refuses, and nothing else reads the two together (issue #1642,
 * clack391's validator request, 2026-08-27).
 *
 * This does not re-implement the anchor rule: it parses each lever's own
 * "API change" cell into a minimal synthetic query (does it clear `surname`,
 * keep it, or supply `recordCountry`/`batchNumber` instead?) and calls the
 * REAL `validateInput` on it. A row whose prose still clears the anchor
 * without replacing it fails here with the file, the row, and the
 * validator's own rejection message.
 *
 * Deliberately narrow: this checks the ANCHOR requirement only (surname /
 * recordCountry / batchNumber), which is what every lever row states an
 * opinion on. It does not attempt to reconstruct or validate every other
 * field a lever touches.
 */

const here = dirname(fileURLToPath(import.meta.url));
const leversPath = join(
  here, "..", "..", "..", "..", "..",
  "packages", "engine", "plugin", "skills", "search-records",
  "references", "search-strategy-levers.md",
);
const leversMd = readFileSync(leversPath, "utf8");
const NL = String.fromCharCode(10);

interface LeverRow {
  section: string;
  lever: string;
  apiChange: string;
}

const HEADER_WORDS = new Set(["Lever", "---", ""]);

function isDataRow(cells: string[]): boolean {
  const second = cells[1] ?? "";
  const isHeader = HEADER_WORDS.has(second);
  const dashesOnly = second.length > 0 && second.replace(/-/g, "") === "";
  return cells.length >= 3 && isHeader === false && dashesOnly === false;
}

function rowsFromBody(body: string, section: string): LeverRow[] {
  const rows: LeverRow[] = [];
  const lines = body.split(NL);
  for (const line of lines) {
    const isTableLine = line.startsWith("|");
    if (isTableLine === false) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (isDataRow(cells) === false) continue;
    rows.push({ section, lever: cells[1], apiChange: cells[2] });
  }
  return rows;
}

function tableRowsInSection(md: string, heading: string): LeverRow[] {
  const marker = "## " + heading;
  const start = md.indexOf(marker);
  if (start === -1) throw new Error("section not found: " + heading);
  const rest = md.slice(start + marker.length);
  const nextHeading = rest.indexOf(NL + "## ");
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  return rowsFromBody(body, heading);
}

const SURNAME_ABSENT_BY_NAME = new Set([
  "Drop both names",
  "Drop all filters, single identifier",
]);

function deriveShape(row: LeverRow): { applies: boolean; shape: RecordSearchInput } {
  const apiChange = row.apiChange;
  const keepsSurname = /keep\s+`?q\.surname`?/i.test(apiChange);
  if (keepsSurname) {
    return { applies: true, shape: { surname: "Test" } as RecordSearchInput };
  }

  const clearsQSurname = /clear\s+`?q\.surname`?/i.test(apiChange);
  const clearsPrincipalName = /clear\s+(?:all\s+)?principal\s+name/i.test(apiChange);
  const clearsByName = SURNAME_ABSENT_BY_NAME.has(row.lever);
  const surnameCleared = clearsQSurname || clearsPrincipalName || clearsByName;

  if (surnameCleared === false) {
    return { applies: false, shape: {} as RecordSearchInput };
  }

  const mentionsCountry = /recordCountry/i.test(apiChange);
  const mentionsBatch = /batchNumber/i.test(apiChange);
  const shape = {} as RecordSearchInput;
  if (mentionsCountry) shape.recordCountry = "United States";
  else if (mentionsBatch) shape.batchNumber = "B01883-5";
  return { applies: true, shape };
}

const NAME_LEVER_ROWS = tableRowsInSection(leversMd, "Name levers");
const FILTER_LEVER_ROWS = tableRowsInSection(leversMd, "Filter levers");
const ALL_ROWS = NAME_LEVER_ROWS.concat(FILTER_LEVER_ROWS);

it("the anchor reminder is still present (drift guard for the rows below)", () => {
  expect(leversMd).toContain("Anchor reminder before using any lever below.");
});

it("every Name-lever row was actually found", () => {
  expect(NAME_LEVER_ROWS.length).toBeGreaterThanOrEqual(9);
});

for (const row of ALL_ROWS) {
  const check = deriveShape(row);
  if (check.applies === false) continue;
  const label = row.section + " > " + row.lever;
  it(label, () => {
    const message =
      row.section + " row \"" + row.lever + "\" (cell: " + JSON.stringify(row.apiChange) +
      ") derives the query " + JSON.stringify(check.shape) +
      ", which the real validateInput rejects. Every lever that clears surname " +
      "must set recordCountry or batchNumber in its place.";
    let threw = false;
    try {
      validateInput(check.shape);
    } catch (e) {
      threw = true;
    }
    expect(threw, message).toBe(false);
  });
}
