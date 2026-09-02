import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateInput as validateRecordSearch } from "../../src/tools/record-search.js";
import { validateInput as validatePersonSearch } from "../../src/tools/person-search.js";

/**
 * A search fixture's echoed `query` must be a call the tool would ACCEPT.
 *
 * `mcp-fixture-shape.test.ts` compares top-level key NAMES, by design, so it is
 * blind to a value the tool could never have produced. `query` is the one field
 * where that gap is cheap to close and expensive to leave: it is
 * `echoQuery(input)`, a verbatim echo of the call, so a `query` the tool's own
 * input validator refuses describes an interaction that cannot happen — the
 * request would have thrown before any response existed.
 *
 * This is not hypothetical, and it is why the check exists rather than being
 * deferred with the rest of the value-level class. `record_search`'s
 * `validateInput` requires one of `surname`, `recordCountry` or `batchNumber`;
 * running it over the corpus found 2 fixtures echoing a query anchored only on
 * `collectionId`. Both were pre-existing. Eight more were repaired in the same
 * PR, ten in total, and without this check every one of them can silently
 * regress: the shape check compares key NAMES, so it stays green on all ten.
 *
 * SCOPE, and why it is not generic. It covers the two tools that export an
 * input validator (`record_search`, `person_search`). The rest of the value-level
 * class needs per-tool invariants that do not exist yet — a `wiki_place_page`
 * `url` is only checkable by rebuilding it from `candidateSlugsFor(section,
 * placeName)`, and a naive generic rule (does the `args` predicate match the
 * echoed `query`?) has real false positives, because `volume_search` legitimately
 * resolves a place upward so the echo names a broader jurisdiction than the
 * predicate matched. Adding a tool here is one line once it exports a validator.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root
const fixturesDir = join(projectRoot, "eval", "fixtures", "mcp");

/** tool name -> the validator its own source exports for that tool's input. */
const VALIDATORS: Record<string, (input: never) => void> = {
  record_search: validateRecordSearch as (input: never) => void,
  person_search: validatePersonSearch as (input: never) => void,
};

interface QueryFixture {
  name: string;
  tool: string;
  query: unknown;
}

function fixturePaths(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...fixturePaths(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".json")) out.push(rel);
  }
  return out.sort();
}

const candidates: QueryFixture[] = fixturePaths(fixturesDir)
  .map((rel) => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, rel), "utf8")) as Record<
      string,
      unknown
    >;
    const response = raw.response;
    const query =
      typeof response === "object" && response !== null && !Array.isArray(response)
        ? (response as Record<string, unknown>).query
        : undefined;
    return { name: rel, tool: String(raw.tool ?? ""), query };
  })
  .filter((f) => f.tool in VALIDATORS);

describe("eval/fixtures/mcp echoed queries are calls the tool accepts", () => {
  it("finds fixtures for every tool with a validator (guards the sweep itself)", () => {
    // A glob that matches nothing is the failure mode a lint cannot report.
    const missing = Object.keys(VALIDATORS).filter(
      (tool) => !candidates.some((f) => f.tool === tool),
    );
    expect(
      missing,
      "these tools have an input validator but no fixtures were found for them — " +
        "if a tool was renamed, update VALIDATORS rather than leaving it unswept",
    ).toEqual([]);
  });

  it("every echoed query passes its tool's own input validator", () => {
    const failures: string[] = [];
    for (const fixture of candidates) {
      // `query` is required on both these tools' response types, and the shape
      // check enforces that. A fixture missing it fails there, not here.
      if (fixture.query === undefined) continue;
      if (
        typeof fixture.query !== "object" ||
        fixture.query === null ||
        Array.isArray(fixture.query)
      ) {
        failures.push(`${fixture.name} (${fixture.tool}): query is not an object`);
        continue;
      }
      try {
        VALIDATORS[fixture.tool](fixture.query as never);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${fixture.name} (${fixture.tool}): ${message}`);
      }
    }
    expect(
      failures,
      "`query` echoes the call verbatim, so a query the tool's validator refuses " +
        "describes a request that would have thrown before any response existed",
    ).toEqual([]);
  });
});
