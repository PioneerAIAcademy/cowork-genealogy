/**
 * One-off: reshape the recorded `catalog_search` answers in
 * `eval/fixtures/mcp/catalog-search-*.json` with the tool's own shaping code, so
 * a fixture holds what the tool returns now (one entry per reel, no `shelf`, no
 * `imageStartNumber`, film notes within the answer budget) instead of a
 * hand-edit of it.
 *
 *   npx tsx dev/reshape-catalog-fixtures.ts           # rewrite the fixtures
 *   npx tsx dev/reshape-catalog-fixtures.ts --check   # change nothing; exit 1 if any fixture would change
 *
 * Only each fixture's `response` is touched, through `shapeAnswer`, the function
 * the tool ends in. The files are hand-formatted (2-space objects, scalar arrays
 * on one line), so a reshape that went through `JSON.stringify(x, null, 2)` would
 * rewrite every array and bury the real change. The writer below reproduces that
 * format, and BEFORE it rewrites anything it is run over the file as it stands: a
 * file it does not reproduce byte for byte is refused, not rewritten.
 *
 * Idempotent: a second run changes nothing. `tests/tools/catalog-search.test.ts`
 * asserts the same of every fixture, so the fixtures cannot drift from the tool.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shapeAnswer } from "../src/tools/catalog-search.js";
import type { CatalogSearchResult } from "../src/types/catalog-search.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "..", "..", "..", "eval", "fixtures", "mcp");

/** The fixtures' format: objects one key per line, arrays of scalars inline with
 *  ", ", arrays of objects one element per line, `[]` and `{}` for empty. */
function format(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((x) => x === null || typeof x !== "object")) {
      return `[${value.map((x) => JSON.stringify(x)).join(", ")}]`;
    }
    const inner = `${indent}  `;
    return `[\n${value.map((x) => `${inner}${format(x, inner)}`).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Every key anywhere under `value` named `key`, counted. */
function countKey(value: unknown, key: string): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countKey(v, key), 0);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).reduce((n, [k, v]) => n + (k === key ? 1 : 0) + countKey(v, key), 0);
  }
  return 0;
}

const check = process.argv.includes("--check");
const files = readdirSync(FIXTURES)
  .filter((f) => /^catalog-search-.*\.json$/.test(f))
  .sort();
if (files.length === 0) {
  console.error(`no catalog-search-*.json under ${FIXTURES}: the glob matched nothing, so nothing was checked`);
  process.exit(1);
}

let changed = 0;
for (const file of files) {
  const path = join(FIXTURES, file);
  const original = readFileSync(path, "utf-8");
  const parsed = JSON.parse(original) as { response: CatalogSearchResult };

  if (`${format(parsed)}\n` !== original) {
    console.error(`${file}: the writer does not reproduce this file byte for byte, so it will not be rewritten`);
    process.exit(1);
  }

  const before = parsed.response.hits.reduce((n, h) => n + (h.filmNotes?.length ?? 0), 0);
  const shelves = countKey(parsed, "shelf") + countKey(parsed, "imageStartNumber");
  shapeAnswer(parsed.response);
  const after = parsed.response.hits.reduce((n, h) => n + (h.filmNotes?.length ?? 0), 0);
  const next = `${format(parsed)}\n`;
  const differs = next !== original;
  if (differs) changed++;
  console.log(
    `${file.padEnd(46)} ${differs ? (check ? "WOULD CHANGE" : "CHANGED     ") : "unchanged   "}  film-note entries ${before} -> ${after}; ` +
      `shelf/imageStartNumber keys removed: ${shelves - countKey(parsed, "shelf") - countKey(parsed, "imageStartNumber")}`,
  );
  if (differs && !check) writeFileSync(path, next, "utf-8");
}
console.log(`\n${files.length} fixtures, ${changed} ${check ? "would change" : "rewritten"}`);
if (check && changed > 0) process.exit(1);
