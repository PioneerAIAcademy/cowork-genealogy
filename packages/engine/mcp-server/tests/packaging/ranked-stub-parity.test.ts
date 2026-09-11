/**
 * `ranked.matches` REPLACES the inline `results` block on a subject-named
 * search (#1212), so a field that exists only on `RecordSearchResult` is
 * invisible on the dominant call shape.
 *
 * That is not hypothetical: #1212 itself named `events` and `collectionId` as
 * "the two triage fields the ranked stub does not carry" and missed
 * `recordTitle` and `treeMatches` — the latter advertised in record_search's
 * own tool description and read by two spec checks. Nothing failed, because
 * nothing compared the two shapes.
 *
 * So: every `RecordSearchResult` field must be on `RankedMatch` or be named
 * below with a reason. Adding a field to one shape and not the other fails
 * here instead of quietly vanishing from the response most callers read.
 *
 * Deliberately a source-text comparison rather than a type-level one: a
 * `satisfies`/conditional-type check would be erased before any test runs, and
 * the failure mode this guards is a human editing one interface and not the
 * other.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "src", "types");

/**
 * Field names declared directly in `interface <name>`, ignoring comments and
 * any nested object literal. Brace-depth tracked so a field inside an inline
 * `{ … }` type cannot be mistaken for a top-level one.
 */
function interfaceFields(file: string, name: string): Set<string> {
  const text = readFileSync(join(SRC, file), "utf-8");
  const start = text.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`interface ${name} not found in ${file}`);

  const fields = new Set<string>();
  let depth = 0;
  let inBlockComment = false;

  for (const raw of text.slice(start).split("\n").slice(1)) {
    const line = raw.trim();

    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("//") || line.startsWith("*") || line === "") continue;

    if (depth === 0 && line.startsWith("}")) break;

    if (depth === 0) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
      if (m) fields.add(m[1]);
    }
    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;
  }

  if (fields.size === 0) throw new Error(`parsed no fields from ${name}`);
  return fields;
}

/**
 * Present on a search row, deliberately absent from a ranked stub. Each needs a
 * reason — "we didn't get to it" is the thing this test exists to catch.
 */
const DELIBERATELY_NOT_RANKED: Record<string, string> = {
  gedcomx:
    "stripped by compactStagedRecordSearch before ranking; the staged sidecar keeps it",
  collectionUrl:
    "stripped by compactStagedRecordSearch; derivable from collectionId",
  score:
    "FamilySearch's own search relevance. matchScore supersedes it, and shipping both invites triage on the weaker number",
  confidence:
    "same as `score` — FS search relevance, superseded by matchConfidence",
};

describe("ranked stub / search row field parity", () => {
  it("every RecordSearchResult field is on RankedMatch or deliberately excluded", () => {
    const row = interfaceFields("record-search.ts", "RecordSearchResult");
    const stub = interfaceFields("rank-search-matches.ts", "RankedMatch");

    const missing = [...row].filter(
      (f) => !stub.has(f) && !(f in DELIBERATELY_NOT_RANKED),
    );

    expect(missing, [
      `These fields are on a search row but not on a ranked stub, and are not`,
      `listed in DELIBERATELY_NOT_RANKED:`,
      ``,
      ...missing.map((f) => `  - ${f}`),
      ``,
      `Since #1212 \`ranked\` replaces \`results\` on a subject-named search, so`,
      `each of these is invisible on the dominant call shape. Carry it in`,
      `toStub() (src/tools/rank-search-matches.ts), or add it to`,
      `DELIBERATELY_NOT_RANKED with the reason.`,
    ].join("\n")).toEqual([]);
  });

  it("the exclusion list names no field that is absent or already carried", () => {
    // A stale entry silently re-opens the hole it was written to document.
    const row = interfaceFields("record-search.ts", "RecordSearchResult");
    const stub = interfaceFields("rank-search-matches.ts", "RankedMatch");

    for (const field of Object.keys(DELIBERATELY_NOT_RANKED)) {
      expect(row.has(field), `${field} is excluded but not on RecordSearchResult`).toBe(true);
      expect(stub.has(field), `${field} is excluded but IS on RankedMatch`).toBe(false);
    }
  });

  it("the four fields #1212 had to add are actually carried", () => {
    const stub = interfaceFields("rank-search-matches.ts", "RankedMatch");
    for (const f of ["events", "collectionId", "recordTitle", "treeMatches"]) {
      expect(stub.has(f), `RankedMatch lost ${f}`).toBe(true);
    }
  });
});
