import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * Scan a single file for lines containing `∈` whose left-hand side names
 * a closed enum, then extract the value set from the right-hand side.
 *
 * Two prose patterns are handled:
 *   Pattern A (spaced pipes):  `name` ∈ `v1` | `v2` | `v3` (closed set …)
 *   Pattern B (compact pipes): `name` ∈ `v1|v2|v3` ·
 */
function extractDeclarationsFromFile(
  absPath: string,
  relPath: string,
  closedNames: Set<string>,
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
for (const { abs, rel } of allFiles) {
  allDecls.push(...extractDeclarationsFromFile(abs, rel, closedNames));
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
