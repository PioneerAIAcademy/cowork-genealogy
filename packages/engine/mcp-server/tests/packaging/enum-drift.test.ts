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
 * Scan a single file for lines containing `∈` whose left-hand side names
 * a closed enum, then extract the value set from the right-hand side.
 *
 * Two prose patterns are handled:
 *   Pattern A (spaced pipes):  `name` ∈ `v1` | `v2` | `v3` (closed set …)
 *   Pattern B (compact pipes): `name` ∈ `v1|v2|v3` ·
 *
 * Values are read only out of backtick spans, but the enum *name* match is
 * plain text — so a declaration written without backticks is recognized as a
 * declaration and then yields nothing. Appending unparsed lines to `unparsed`
 * (asserted empty below) is what keeps that from being silent: dropping them
 * here would make a declaration this scan cannot read indistinguishable from a
 * file that declares no enum at all. Same reasoning as the discovery-guard
 * test — a silent no-op reads as coverage.
 */
function extractDeclarationsFromFile(
  absPath: string,
  relPath: string,
  closedNames: Set<string>,
  unparsed: UnparsedDecl[],
): ProseDecl[] {
  const content = readFileSync(absPath, "utf8");
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

    // The enum name must appear before ∈ on the same line.
    // Check longest names first so a prefix can't shadow a longer name.
    const before = lines[i].slice(0, elemIdx);
    let matchedEnum: string | null = null;
    for (const name of closedNamesByLength) {
      if (before.includes(name)) {
        matchedEnum = name;
        break;
      }
    }
    if (!matchedEnum) continue;

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
      "evidence_type",
    ],
  },
  {
    relPath: "skills/research/SKILL.md",
    enums: [
      "evidence_type",
      "information_quality",
      "informant_proximity",
      "date_certainty",
      "source_classification",
    ],
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

  // The EXPECTED registry only protects the two files listed in it. Everywhere
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
 * Enum names the validator enforces that `enums.schema.json` does NOT define
 * as a closed `$def`. Verified 2026-07-30, and each is deliberate rather than
 * an omission:
 *
 *   - `experience_level` — defined inline at
 *     `research.schema.json#/$defs/researcher_profile/properties/experience_level`
 *     (same four values), never lifted into the shared enums file.
 *   - `evaluation_focus`, `evaluation_target_type`, `evaluation_verdict`,
 *     `subscription` — code-only; no schema defines them at all.
 *
 * Asserted as an EXACT set, both directions. A new name appearing means
 * someone added a code-only enum that no schema constrains — decide whether it
 * belongs in enums.schema.json before adding it here. A name disappearing means
 * it was promoted into the schema, and it should come off this list so the
 * value-equality check below starts covering it.
 */
const VALIDATOR_ONLY = new Set([
  "evaluation_focus",
  "evaluation_target_type",
  "evaluation_verdict",
  "experience_level",
  "subscription",
]);

describe("validator enums match enums.schema.json", () => {
  const validatorNames = new Set(Object.keys(VALIDATOR_ENUMS));

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
