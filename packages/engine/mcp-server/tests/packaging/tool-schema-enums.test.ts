import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MCP tool input schemas must not re-type a closed enum's values.
 *
 * `VALIDATOR_ENUMS` (src/validation/validator.ts) is already diffed against
 * enums.schema.json by enum-drift.test.ts, so a tool schema that spreads it
 * inherits that guard for free. A hand-typed literal inherits nothing: the
 * advertised schema and the validator can disagree about what the tool accepts,
 * and the model is told the stale set.
 *
 * The rule is mechanical — a literal string array whose value set is exactly a
 * closed enum's value set — so it also catches an enum this test has never
 * heard of, which is the point.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..");
const projectRoot = join(engineRoot, "..", "..", "..");
const toolsDir = join(engineRoot, "src", "tools");

/**
 * Values that coincide with a closed enum but are not that enum.
 *
 * `sex` on the two search tools is a FamilySearch **query qualifier** — the
 * upstream search API's own value space, normalized case-insensitively on input
 * — that happens to spell the same three words as simplified-GedcomX `gender`.
 * Binding them would invent a dependency on an API we do not own: FS can add a
 * value without research.json doing so, and vice versa.
 */
const EXEMPT: Array<{ file: string; enumName: string; why: string }> = [
  { file: "record-search.ts", enumName: "gender", why: "FamilySearch search-API `sex` qualifier, owned upstream" },
  { file: "person-search.ts", enumName: "gender", why: "FamilySearch search-API `sex` qualifier, owned upstream" },
];

function closedEnums(): Map<string, Set<string>> {
  const schema = JSON.parse(
    readFileSync(join(projectRoot, "docs", "specs", "schemas", "enums.schema.json"), "utf8"),
  );
  const out = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries<any>(schema.$defs ?? {})) {
    if (Array.isArray(def.enum)) out.set(name, new Set(def.enum as string[]));
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  enumName: string;
}

/** Every `[ "a", "b", … ]` literal in the file, with its 1-based start line. */
function literalArrays(src: string): Array<{ values: Set<string>; line: number }> {
  // Only all-string-literal arrays; anything holding an identifier or a spread
  // already references a shared const and is not a copy.
  const re = /\[\s*((?:"[^"]*"\s*,\s*)+"[^"]*"\s*,?)\s*\]/g;
  return [...src.matchAll(re)].map((m) => ({
    values: new Set([...m[1].matchAll(/"([^"]*)"/g)].map((v) => v[1])),
    line: src.slice(0, m.index).split("\n").length,
  }));
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((v) => b.has(v));

describe("tool input schemas reference VALIDATOR_ENUMS, not hand-typed values", () => {
  const enums = closedEnums();
  const files = readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));

  const hits: Hit[] = [];
  for (const file of files) {
    const src = readFileSync(join(toolsDir, file), "utf8");
    for (const { values, line } of literalArrays(src)) {
      for (const [enumName, schemaValues] of enums) {
        if (sameSet(values, schemaValues)) hits.push({ file, line, enumName });
      }
    }
  }

  it("scans a plausible number of tool files", () => {
    // A mistyped path would yield zero hits, which reads exactly like success.
    expect(files.length, "src/tools/*.ts").toBeGreaterThan(20);
    expect(enums.size, "closed enums in enums.schema.json").toBeGreaterThan(20);
  });

  it("every exemption still corresponds to a real literal", () => {
    // If a exempted site is collapsed later, the exemption must go with it —
    // otherwise the list silently grows stale and hides the next real hit.
    const unused = EXEMPT.filter(
      (e) => !hits.some((h) => h.file === e.file && h.enumName === e.enumName),
    );
    expect(
      unused.map((e) => `${e.file} (${e.enumName})`),
      "exemption no longer matches any literal — delete it from EXEMPT",
    ).toEqual([]);
  });

  it("no unexempted literal re-types a closed enum", () => {
    const offenders = hits
      .filter((h) => !EXEMPT.some((e) => e.file === h.file && e.enumName === h.enumName))
      .map((h) => `src/tools/${h.file}:${h.line} re-types \`${h.enumName}\` — use [...VALIDATOR_ENUMS.${h.enumName}]`);
    expect(offenders).toEqual([]);
  });
});
