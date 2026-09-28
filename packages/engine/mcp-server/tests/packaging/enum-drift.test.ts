import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VALIDATOR_ENUMS } from "../../src/validation/validator.js";

/**
 * Enum-drift lint (issue #694).
 *
 * Plugin agents, skill bodies, and eval rubrics sometimes reproduce the
 * full value-list of a closed enum from enums.schema.json inline in prose
 * (marked by the ∈ symbol). When a schema enum gains or loses a value,
 * those prose copies must be updated in lockstep — this test catches drift.
 *
 * The approach:
 * 1. Load canonical closed-enum definitions from enums.schema.json.
 * 2. Verify both schema copies (docs/specs/ and packages/schema/) are
 *    byte-identical.
 * 3. Auto-discover every ∈ declaration in plugin files and rubrics whose
 *    left-hand side names a closed enum.
 * 4. Extract the prose value set and diff it against the schema.
 * 5. A minimum-coverage registry ensures declarations aren't silently
 *    removed without updating this test.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(here, "..", "..", ".."); // packages/engine/
const projectRoot = join(engineRoot, "..", ".."); // repo root

// ─── Schema loading ────────────────────────────────────────────────

const SCHEMA_PATHS = [
  join(projectRoot, "docs", "specs", "schemas", "enums.schema.json"),
  join(projectRoot, "packages", "schema", "schemas", "enums.schema.json"),
] as const;

type ClosedEnums = Map<string, Set<string>>;

/**
 * Closed enums declared inline in research.schema.json rather than as an
 * enums.schema.json `$def`, so the validator cannot be diffed against them.
 * EMPTY, and the emptiness is the policy: #1015 moved five into
 * enums.schema.json and #1270 moved the last (`locality.pages_read[].section`,
 * now `locality_page_section`). A new inline enum must move into
 * enums.schema.json (and be $ref'd) rather than being listed here — this array
 * survives only so the assertion below keeps naming the one that got missed.
 */
const INLINE_NOT_ENFORCED: string[] = [];

function loadClosedEnums(schemaPath: string): ClosedEnums {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const defs: Record<string, any> = schema.$defs ?? {};
  const result: ClosedEnums = new Map();
  for (const [name, def] of Object.entries(defs)) {
    // Closed enums have an "enum" array; open enums use "examples" and
    // a *_recommended naming convention.
    if (Array.isArray(def.enum)) {
      result.set(name, new Set(def.enum as string[]));
    }
  }

  return result;
}

// ─── Prose-declaration discovery ───────────────────────────────────

interface ProseDecl {
  /** Display-friendly relative path (e.g. "agents/record-extractor.md"). */
  relPath: string;
  enumName: string;
  /** 1-based line number where ∈ appears. */
  lineNo: number;
  /** Enum values extracted from the prose. */
  values: Set<string>;
}

/** A line that names a closed enum before ∈ but whose values wouldn't parse. */
interface UnparsedDecl {
  relPath: string;
  enumName: string;
  lineNo: number;
}

/**
 * Scan content for lines containing `∈` whose left-hand side names a closed
 * enum, then extract the value set from the right-hand side.
 *
 * Two prose patterns are handled:
 *   Pattern A (spaced pipes):  `name` ∈ `v1` | `v2` | `v3` (closed set …)
 *   Pattern B (compact pipes): `name` ∈ `v1|v2|v3` ·
 *
 * The enum name is matched by a backticked identifier immediately adjacent to
 * `∈` (allowing a bold closer and whitespace — **`enum`** ∈). Three outcomes:
 *
 *   1. Adjacent backtick names a closed enum → declaration. Extract values.
 *   2. Adjacent backtick names something else → not a declaration, skip.
 *   3. No adjacent backtick, but a closed-enum name appears somewhere before
 *      `∈` → malformed declaration → pushed to `unparsed` (asserted empty by
 *      the test below, keeping un-backticked declarations loud).
 */
function extractDeclarationsFromContent(
  content: string,
  relPath: string,
  closedNames: Set<string>,
  unparsed: UnparsedDecl[],
): ProseDecl[] {
  const lines = content.split(/\r?\n/);
  const decls: ProseDecl[] = [];
  // Sort longest-first so "date_certainty_timeline" matches before its
  // prefix "date_certainty".
  const closedNamesByLength = [...closedNames].sort(
    (a, b) => b.length - a.length,
  );

  for (let i = 0; i < lines.length; i++) {
    const elemIdx = lines[i].indexOf("\u2208"); // ∈
    if (elemIdx === -1) continue;

    const before = lines[i].slice(0, elemIdx);

    // Step A: check for adjacent backticked identifier.
    const adjacentMatch = before.match(/`([A-Za-z_][A-Za-z0-9_]*)`\**\s*$/);
    let matchedEnum: string | null = null;

    if (adjacentMatch) {
      if (closedNames.has(adjacentMatch[1])) {
        matchedEnum = adjacentMatch[1];
      } else {
        // Not a closed enum (e.g. preferred_assertion_id) — skip.
        continue;
      }
    } else {
      // Step B: no adjacent backtick — loose scan for unparsed guard.
      const looseMatch = closedNamesByLength.find(
        (name) => before.includes(name),
      );
      if (looseMatch) {
        unparsed.push({ relPath, enumName: looseMatch, lineNo: i + 1 });
      }
      continue;
    }

    // Gather a multi-line chunk starting right after ∈ — Pattern A wraps
    // values across lines. Stop at the first blank line or 10 lines.
    let chunk = lines[i].slice(elemIdx + 1);
    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      if (lines[j].trim() === "") break;
      chunk += " " + lines[j];
    }

    // Trim at the first boundary that ends the value list.
    // Order doesn't matter — each trim can only shorten the chunk.
    const parenIdx = chunk.indexOf("(");
    if (parenIdx !== -1) chunk = chunk.slice(0, parenIdx);

    const midDotIdx = chunk.indexOf("\u00B7"); // ·
    if (midDotIdx !== -1) chunk = chunk.slice(0, midDotIdx);

    // Sentence-ending period right after a closing backtick.
    const periodMatch = chunk.match(/`\s*\./);
    if (periodMatch?.index !== undefined) {
      chunk = chunk.slice(0, periodMatch.index + 1); // keep the backtick
    }

    // Extract backtick-quoted content and split compact pipe forms.
    const values = new Set<string>();
    for (const [, inner] of chunk.matchAll(/`([^`]+)`/g)) {
      for (const raw of inner.split("|")) {
        const v = raw.trim();
        // Valid enum values are alphabetic identifiers (may contain _).
        if (v && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(v)) {
          values.add(v);
        }
      }
    }

    if (values.size > 0) {
      decls.push({ relPath, enumName: matchedEnum, lineNo: i + 1, values });
    } else {
      unparsed.push({ relPath, enumName: matchedEnum, lineNo: i + 1 });
    }
  }

  return decls;
}

function extractDeclarationsFromFile(
  absPath: string,
  relPath: string,
  closedNames: Set<string>,
  unparsed: UnparsedDecl[],
): ProseDecl[] {
  const content = readFileSync(absPath, "utf8");
  return extractDeclarationsFromContent(content, relPath, closedNames, unparsed);
}

// ─── File discovery ────────────────────────────────────────────────

function discoverPluginFiles(): { abs: string; rel: string }[] {
  const pluginRoot = join(engineRoot, "plugin");
  const files: { abs: string; rel: string }[] = [];

  const agentsDir = join(pluginRoot, "agents");
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir)) {
      if (f.endsWith(".md")) {
        files.push({ abs: join(agentsDir, f), rel: `agents/${f}` });
      }
    }
  }

  const skillsDir = join(pluginRoot, "skills");
  if (existsSync(skillsDir)) {
    for (const d of readdirSync(skillsDir)) {
      const p = join(skillsDir, d, "SKILL.md");
      if (existsSync(p)) {
        files.push({ abs: p, rel: `skills/${d}/SKILL.md` });
      }

      // A skill's references/ hold much of its detailed doctrine — 75 files,
      // ~3x the SKILL.md count. None carries an ∈ declaration today, so this
      // adds no assertions; it is here so that one written tomorrow is linted
      // the day it lands rather than whenever someone remembers this test.
      const refsDir = join(skillsDir, d, "references");
      if (existsSync(refsDir)) {
        for (const f of readdirSync(refsDir)) {
          if (f.endsWith(".md")) {
            files.push({
              abs: join(refsDir, f),
              rel: `skills/${d}/references/${f}`,
            });
          }
        }
      }
    }
  }

  return files;
}

function discoverRubricFiles(): { abs: string; rel: string }[] {
  const dir = join(projectRoot, "eval", "tests", "unit");
  const files: { abs: string; rel: string }[] = [];
  if (existsSync(dir)) {
    for (const d of readdirSync(dir)) {
      const p = join(dir, d, "rubric.md");
      if (existsSync(p)) {
        files.push({ abs: p, rel: `eval/tests/unit/${d}/rubric.md` });
      }
    }
  }
  return files;
}

// ─── Build the full declaration list ───────────────────────────────

const canonical = loadClosedEnums(SCHEMA_PATHS[0]);
const closedNames = new Set(canonical.keys());

const allFiles = [...discoverPluginFiles(), ...discoverRubricFiles()];
const allDecls: ProseDecl[] = [];
const unparsedDecls: UnparsedDecl[] = [];
for (const { abs, rel } of allFiles) {
  allDecls.push(
    ...extractDeclarationsFromFile(abs, rel, closedNames, unparsedDecls),
  );
}

// Minimum-coverage registry: these (file, enum) pairs must be present.
// Add entries here when a new ∈ declaration is introduced in a plugin
// file — this prevents silent removal.
const EXPECTED: Array<{ relPath: string; enums: string[] }> = [
  {
    relPath: "agents/record-extractor.md",
    enums: [
      "source_classification",
      "date_certainty",
      "information_quality",
      "informant_proximity",
      "record_basis",
    ],
  },
  {
    relPath: "skills/research/SKILL.md",
    enums: [
      "record_basis",
      "information_quality",
      "informant_proximity",
      "date_certainty",
      "source_classification",
    ],
  },
  // question-selection states the legal question statuses in order to say it
  // writes none of them (#1135). Declared with ∈ rather than as prose so this
  // lint owns the copy — the instruction it replaced named two values that were
  // never in the enum at all, and nothing noticed.
  {
    relPath: "skills/question-selection/SKILL.md",
    enums: ["question_status"],
  },
];

// ─── Tests ─────────────────────────────────────────────────────────

describe("enum-drift lint", () => {
  it("both enums.schema.json copies are byte-identical", () => {
    const a = readFileSync(SCHEMA_PATHS[0], "utf8");
    const b = readFileSync(SCHEMA_PATHS[1], "utf8");
    expect(a).toBe(b);
  });

  it("discovers at least the expected number of ∈ declarations", () => {
    const expectedCount = EXPECTED.reduce((n, e) => n + e.enums.length, 0);
    expect(allDecls.length).toBeGreaterThanOrEqual(expectedCount);
  });

  // No reference file declares an enum today, so nothing above would fail if
  // this directory stopped being walked — a mistyped path would be a silent
  // no-op that reads as coverage. Assert the walk itself instead of its
  // (currently empty) yield.
  it("scans agents, SKILL.md bodies, skill references, and rubrics", () => {
    const count = (prefix: string, suffix: string) =>
      allFiles.filter((f) => f.rel.startsWith(prefix) && f.rel.endsWith(suffix))
        .length;

    expect(count("agents/", ".md"), "agent bodies").toBeGreaterThan(0);
    expect(count("skills/", "/SKILL.md"), "skill bodies").toBeGreaterThan(0);
    expect(
      allFiles.filter((f) => /^skills\/[^/]+\/references\/.+\.md$/.test(f.rel))
        .length,
      "skill reference files",
    ).toBeGreaterThan(0);
    expect(count("eval/tests/unit/", "/rubric.md"), "rubrics").toBeGreaterThan(
      0,
    );
  });

  // The EXPECTED registry only protects the files listed in it. Everywhere
  // else — the 75 references/ files and the rubrics — a declaration this scan
  // can't parse would otherwise vanish without a trace, which is exactly the
  // surface the registry does not cover. Fail on the parse instead of on the
  // absence, so the author who wrote the line is the one who hears about it.
  it("every ∈ declaration naming a closed enum parses into values", () => {
    expect(
      unparsedDecls.map((d) => `${d.relPath}:${d.lineNo} (${d.enumName})`),
      "declaration found but no values extracted — write the values in " +
        "backticks: `v1` | `v2` | `v3`, or `v1|v2|v3`",
    ).toEqual([]);
  });

  describe("expected ∈ declarations are present", () => {
    for (const { relPath, enums } of EXPECTED) {
      for (const enumName of enums) {
        it(`${relPath} declares ${enumName}`, () => {
          const found = allDecls.some(
            (d) => d.relPath === relPath && d.enumName === enumName,
          );
          expect(
            found,
            `no ∈ declaration for ${enumName} found in ${relPath}`,
          ).toBe(true);
        });
      }
    }
  });

  describe("prose values match schema", () => {
    for (const decl of allDecls) {
      it(`${decl.relPath}:${decl.lineNo} — ${decl.enumName}`, () => {
        const schemaValues = canonical.get(decl.enumName);
        expect(
          schemaValues,
          `${decl.enumName} is not a closed enum in enums.schema.json`,
        ).toBeDefined();

        const stale = [...decl.values]
          .filter((v) => !schemaValues!.has(v))
          .sort();
        const missing = [...schemaValues!]
          .filter((v) => !decl.values.has(v))
          .sort();

        if (stale.length > 0 || missing.length > 0) {
          const parts: string[] = [];
          if (stale.length > 0) {
            parts.push(`stale (in prose, not in schema): ${stale.join(", ")}`);
          }
          if (missing.length > 0) {
            parts.push(
              `missing (in schema, not in prose): ${missing.join(", ")}`,
            );
          }
          expect.fail(
            `${decl.enumName} drift at ${decl.relPath}:${decl.lineNo}\n${parts.join("\n")}`,
          );
        }
      });
    }
  });

  describe("anchored matcher rejects loose matches", () => {
    it("a line mentioning an enum in passing before an unrelated ∈ is not a declaration", () => {
      // Shape 1: loose misbind — date_certainty appears in prose, not as a
      // backtick-adjacent declaration.
      const fixture = "The date_certainty field is used when foo ∈ {bar, baz}";
      const unparsed: UnparsedDecl[] = [];
      const decls = extractDeclarationsFromContent(
        fixture, "fixture.md", closedNames, unparsed,
      );
      expect(decls, "must not bind as a declaration").toEqual([]);
      expect(
        unparsed.map((d) => d.enumName),
        "loose mention must land in unparsed",
      ).toEqual(["date_certainty"]);
    });

    it("an un-backticked declaration lands in unparsed", () => {
      // Shape 2: un-backticked declaration — enum name present but no backticks.
      const fixture = "record_basis ∈ stated | inferred | absent";
      const unparsed: UnparsedDecl[] = [];
      const decls = extractDeclarationsFromContent(
        fixture, "fixture.md", closedNames, unparsed,
      );
      expect(decls, "must not bind as a declaration").toEqual([]);
      expect(
        unparsed.map((d) => d.enumName),
        "un-backticked declaration must land in unparsed",
      ).toEqual(["record_basis"]);
    });
  });
});

// ─── The fourth copy: spec enum tables ───────────────────────────

interface SpecTableRow {
  file: string;
  lineNo: number;
  enumName: string;
  values: Set<string>;
}

/**
 * Extract closed-enum rows from a markdown spec file's tables.
 * Keyed on the table header: finds a header row whose cells include "Values",
 * then reads subsequent rows whose first data cell is a backticked closed-enum
 * name. Resets on leaving the table.
 */
function extractSpecTableEnums(
  content: string,
  file: string,
  closedNames: Set<string>,
): SpecTableRow[] {
  const lines = content.split(/\r?\n/);
  const rows: SpecTableRow[] = [];
  let valuesColIdx = -1; // 0-based index among data cells
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Not a table line → reset.
    if (!line.startsWith("|")) {
      inTable = false;
      valuesColIdx = -1;
      continue;
    }

    // Separator row (|---|---|...) → skip but stay in table.
    if (/^\|[\s-|]+$/.test(line)) continue;

    // Split by | and drop the empty first/last from leading/trailing pipes.
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());

    if (!inTable) {
      // Check if this is a header row with a "Values" column.
      const idx = cells.findIndex((c) => c === "Values");
      if (idx !== -1) {
        valuesColIdx = idx;
        inTable = true;
      }
      continue;
    }

    // Inside a table with a Values column — check if first cell is a
    // backticked closed-enum name.
    if (cells.length <= valuesColIdx) continue;
    const firstCell = cells[0];
    const nameMatch = firstCell.match(/^`([A-Za-z_][A-Za-z0-9_]*)`$/);
    if (!nameMatch || !closedNames.has(nameMatch[1])) continue;

    // Extract values from the Values cell — raw backtick spans, no identifier filter.
    const valuesCell = cells[valuesColIdx];
    const values = new Set<string>();
    for (const [, inner] of valuesCell.matchAll(/`([^`]+)`/g)) {
      values.add(inner.trim());
    }

    if (values.size > 0) {
      rows.push({
        file,
        lineNo: i + 1,
        enumName: nameMatch[1],
        values,
      });
    }
  }

  return rows;
}

// ─── Build spec-table rows ──────────────────────────────────────

const SPEC_TABLE_FILES = [
  join(projectRoot, "docs", "specs", "research-schema-spec.md"),
  join(projectRoot, "docs", "specs", "simplified-gedcomx-spec.md"),
];

const specTableRows: SpecTableRow[] = [];
for (const file of SPEC_TABLE_FILES) {
  const content = readFileSync(file, "utf8");
  const relName = file.includes("research-schema") ? "research-schema-spec.md" : "simplified-gedcomx-spec.md";
  specTableRows.push(...extractSpecTableEnums(content, relName, closedNames));
}

describe("spec enum-table values match schema", () => {
  it("every closed enum has a spec-table row", () => {
    const found = new Set(specTableRows.map((r) => r.enumName));
    const missing = [...canonical.keys()].filter((n) => !found.has(n)).sort();
    expect(
      missing,
      `closed enums with no row in the spec enum tables: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  describe("values match the schema", () => {
    for (const row of specTableRows) {
      it(`${row.file}:${row.lineNo} — ${row.enumName}`, () => {
        const schemaValues = canonical.get(row.enumName)!;
        const stale = [...row.values]
          .filter((v) => !schemaValues.has(v))
          .sort();
        const missing = [...schemaValues]
          .filter((v) => !row.values.has(v))
          .sort();

        if (stale.length > 0 || missing.length > 0) {
          const parts: string[] = [];
          if (stale.length > 0) {
            parts.push(`stale (in spec table, not in schema): ${stale.join(", ")}`);
          }
          if (missing.length > 0) {
            parts.push(
              `missing (in schema, not in spec table): ${missing.join(", ")}`,
            );
          }
          expect.fail(
            `${row.enumName} drift at ${row.file}:${row.lineNo}\n${parts.join("\n")}`,
          );
        }
      });
    }
  });

  describe("extractor rejects bad input (prove it fails)", () => {
    it("detects a stale value added to a spec row", () => {
      const fixture = [
        "| Enum name | Values | Used by |",
        "|-----------|--------|---------|",
        "| `record_basis` | `stated`, `inferred`, `absent`, `bogus` | assertions |",
      ].join("\n");
      const rows = extractSpecTableEnums(fixture, "fixture.md", closedNames);
      expect(rows).toHaveLength(1);
      const stale = [...rows[0].values].filter((v) => !canonical.get("record_basis")!.has(v));
      expect(stale, "must detect the stale value").toEqual(["bogus"]);
    });

    it("detects a missing value deleted from a spec row", () => {
      const fixture = [
        "| Enum name | Values | Used by |",
        "|-----------|--------|---------|",
        "| `record_basis` | `stated`, `inferred` | assertions |",
      ].join("\n");
      const rows = extractSpecTableEnums(fixture, "fixture.md", closedNames);
      expect(rows).toHaveLength(1);
      const missing = [...canonical.get("record_basis")!].filter((v) => !rows[0].values.has(v));
      expect(missing, "must detect the missing value").toContain("absent");
    });

    it("detects a missing enum when its row is deleted", () => {
      // Table with one row present, one deleted — the deleted enum must be
      // absent from the extractor's output so the coverage test catches it.
      const fixture = [
        "| Enum name | Values | Used by |",
        "|-----------|--------|---------|",
        "| `record_basis` | `stated`, `inferred`, `absent` | assertions |",
        // proof_tier row deliberately deleted
      ].join("\n");
      const rows = extractSpecTableEnums(fixture, "fixture.md", closedNames);
      expect(rows).toHaveLength(1);
      const found = new Set(rows.map((r) => r.enumName));
      expect(found.has("record_basis"), "present row is found").toBe(true);
      expect(
        found.has("proof_tier"),
        "deleted row must not be found — the coverage test catches it",
      ).toBe(false);
    });
  });

  describe("extractor accepts legitimate non-enum tables", () => {
    it("field tables with no Values header are ignored", () => {
      // Simulates the field tables in research-schema-spec.md that reuse
      // enum names as field names / types.
      const fixture = [
        "| Field | Type | Required | Description |",
        "|-------|------|----------|-------------|",
        "| `source_classification` | `source_classification` | yes | classification |",
        "| `record_basis` | `record_basis` | yes | basis |",
      ].join("\n");
      const rows = extractSpecTableEnums(fixture, "fixture.md", closedNames);
      expect(rows, "field table must not yield enum rows").toEqual([]);
    });

    it("open-enum tables with Recommended values header are ignored", () => {
      const fixture = [
        "| Enum | Schema name | Recommended values | Used by |",
        "|------|-------------|-------------------|---------|",
        "| `fact_type` | `gedcomx_fact_type_recommended` | `Birth`, `Death` | facts |",
      ].join("\n");
      const rows = extractSpecTableEnums(fixture, "fixture.md", closedNames);
      expect(rows, "open-enum table must not yield rows").toEqual([]);
    });
  });
});

// ─── The third copy: the validator's enums, in code ────────────────

/**
 * Prose is not the only hand-maintained copy of enums.schema.json — the MCP
 * validator carries its own (`CLOSED_ENUMS` + four standalone sets, exported
 * as VALIDATOR_ENUMS). It is the copy that decides what the writer tools
 * ACCEPT, so drift here doesn't leave a stale crib note, it lets a bad value
 * persist or rejects a good one. Same lint, higher stakes.
 */

/**
 * Enum names the validator enforces that `enums.schema.json` does NOT define as
 * a closed `$def`. This stays EMPTY, and the emptiness is the policy (#1015,
 * ADR-0008): anything JSON Schema can express belongs in the schema, so a closed
 * enum the validator checks with no schema definition behind it is a bug, not a
 * category. The five that once sat here (`experience_level`, `subscription`,
 * `evaluation_focus`, `evaluation_target_type`, `evaluation_verdict`) were moved
 * into enums.schema.json and are now diffed against it like every other closed
 * enum.
 *
 * Asserted as an EXACT set, both directions. A name reappearing means the
 * validator invented an enum with no schema behind it at all — add the `$def` to
 * enums.schema.json instead of adding the name here.
 */
const VALIDATOR_ONLY = new Set<string>([]);

describe("validator enums match enums.schema.json", () => {
  const validatorNames = new Set(Object.keys(VALIDATOR_ENUMS));

  it("the only unenforced inline enum is the one we know about", () => {
    // Every inline `enum` array left in research.schema.json must be listed in
    // INLINE_NOT_ENFORCED, which is empty: #1015 moved five into enums.schema.json
    // and #1270 moved the last (locality.pages_read[].section). A new inline enum
    // must move into enums.schema.json (and be $ref'd) rather than being
    // invisible the way those six were.
    const research = JSON.parse(
      readFileSync(join(projectRoot, "docs", "specs", "schemas", "research.schema.json"), "utf8"),
    );
    const found: string[] = [];
    const walk = (node: any, path: string) => {
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node.enum)) found.push(path);
      for (const [k, v] of Object.entries(node)) {
        if (k === "enum") continue;
        walk(v, path === "" ? k : `${path}.${k}`);
      }
    };
    walk(research.$defs, "");

    const unaccounted = found.filter((p) => {
      const compact = p.replace(/\.properties\./g, ".").replace(/\.items(\[\d+\])?/g, ".items");
      return !INLINE_NOT_ENFORCED.includes(compact);
    });

    expect(
      unaccounted,
      "inline enum in research.schema.json not listed in INLINE_NOT_ENFORCED — " +
        "move it into enums.schema.json (and $ref it), or add it to INLINE_NOT_ENFORCED",
    ).toEqual([]);
  });

  it("every closed enum in the schema is enforced by the validator", () => {
    const unenforced = [...canonical.keys()]
      .filter((n) => !validatorNames.has(n))
      .sort();
    expect(
      unenforced,
      `closed enums in enums.schema.json with no validator check: ${unenforced.join(", ")}`,
    ).toEqual([]);
  });

  it("validator-only enum names are exactly the known set", () => {
    const actual = [...validatorNames].filter((n) => !canonical.has(n)).sort();
    expect(actual).toEqual([...VALIDATOR_ONLY].sort());
  });

  describe("values match the schema", () => {
    for (const [name, values] of Object.entries(VALIDATOR_ENUMS)) {
      const schemaValues = canonical.get(name);
      if (!schemaValues) continue; // covered by the two set-level tests above
      it(name, () => {
        const stale = [...values].filter((v) => !schemaValues.has(v)).sort();
        const missing = [...schemaValues].filter((v) => !values.has(v)).sort();

        if (stale.length > 0 || missing.length > 0) {
          const parts: string[] = [];
          if (stale.length > 0) {
            parts.push(
              `stale (validator accepts, schema does not define): ${stale.join(", ")}`,
            );
          }
          if (missing.length > 0) {
            parts.push(
              `missing (schema defines, validator rejects): ${missing.join(", ")}`,
            );
          }
          expect.fail(
            `${name} drift in src/validation/validator.ts\n${parts.join("\n")}`,
          );
        }
      });
    }
  });
});
