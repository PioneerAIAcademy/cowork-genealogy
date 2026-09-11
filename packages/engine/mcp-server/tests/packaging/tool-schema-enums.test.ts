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
 * The rule is mechanical — a literal string array whose value set *matches* a
 * closed enum's — so it also catches an enum this test has never heard of,
 * which is the point.
 *
 * "Matches" is deliberately not "equals". Exact equality only sees a copy while
 * the copy is still in sync, and goes blind at precisely the moment the header
 * above describes: a literal that has drifted, or that arrived stale, no longer
 * equals any enum and vanishes from the report. So a near-miss counts too, and
 * is the louder failure of the two — an out-of-sync copy is the actual bug,
 * where an in-sync one is only the bug waiting to happen.
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
  /** Values the schema has and the literal lacks. Empty on an exact copy. */
  missing: string[];
  /** Values the literal has and the schema lacks. Empty on an exact copy. */
  extra: string[];
}

/**
 * Every `[ "a", "b", … ]` literal in the file, with its 1-based start line.
 *
 * Both quote styles: nothing in this package enforces one (no eslint, no
 * prettier config, no lint script), so a single-quoted copy would otherwise be
 * unlintable by construction.
 */
function literalArrays(src: string): Array<{ values: Set<string>; line: number }> {
  // Only all-string-literal arrays; anything holding an identifier or a spread
  // already references a shared const and is not a copy.
  const re = /\[\s*((?:(["'])[^"']*\2\s*,\s*)+(["'])[^"']*\3\s*,?)\s*\]/g;
  return [...src.matchAll(re)].map((m) => ({
    values: new Set([...m[1].matchAll(/["']([^"']*)["']/g)].map((v) => v[1])),
    line: src.slice(0, m.index).split("\n").length,
  }));
}

/**
 * How close a literal must be to a closed enum before it is called a copy of
 * it, as |intersection| / |union|.
 *
 * Measured against the tree as it stands: the two exempt `sex` literals score
 * 1.00, and the highest score any *other* literal in src/tools reaches is 0.10
 * (`record-search.ts`'s `recordType` shares only "other" with `holding_type`).
 * The genuinely tool-local value sets — `operation`, `selector`, `era`,
 * `["append","update"]` — share nothing with any closed enum at all. So there
 * is a wide empty band here, and 0.5 sits in the middle of it rather than at
 * either edge. No allow-list of tool-local enums is needed as a result.
 */
const NEAR_MISS = 0.5;

/** Overlap ratio, plus the two directions of difference. */
function compare(values: Set<string>, schemaValues: Set<string>) {
  const missing = [...schemaValues].filter((v) => !values.has(v));
  const extra = [...values].filter((v) => !schemaValues.has(v));
  const shared = schemaValues.size - missing.length;
  const union = new Set([...values, ...schemaValues]).size;
  return { missing, extra, shared, ratio: shared / union };
}

describe("tool input schemas reference VALIDATOR_ENUMS, not hand-typed values", () => {
  const enums = closedEnums();
  const files = readdirSync(toolsDir).filter((f) => f.endsWith(".ts"));

  const hits: Hit[] = [];
  for (const file of files) {
    const src = readFileSync(join(toolsDir, file), "utf8");
    for (const { values, line } of literalArrays(src)) {
      for (const [enumName, schemaValues] of enums) {
        // `shared >= 2` keeps a two-value enum from matching on one word.
        const { missing, extra, shared, ratio } = compare(values, schemaValues);
        if (shared >= 2 && ratio >= NEAR_MISS) {
          hits.push({ file, line, enumName, missing, extra });
        }
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
      .map((h) => {
        const where = `src/tools/${h.file}:${h.line}`;
        const use = `use [...VALIDATOR_ENUMS.${h.enumName}]`;
        if (h.missing.length === 0 && h.extra.length === 0) {
          return `${where} re-types \`${h.enumName}\` — ${use}`;
        }
        // Already out of sync: the advertised schema and the validator disagree
        // about what the tool accepts RIGHT NOW, so say so rather than filing it
        // under the same "don't copy" heading.
        const drift = [
          h.missing.length ? `missing ${h.missing.map((v) => `"${v}"`).join(", ")}` : "",
          h.extra.length ? `has extra ${h.extra.map((v) => `"${v}"`).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        return `${where} is a STALE copy of \`${h.enumName}\` (${drift}) — the model is being told the wrong set; ${use}`;
      });
    expect(offenders).toEqual([]);
  });
});
