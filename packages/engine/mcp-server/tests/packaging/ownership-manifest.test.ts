import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { allToolSchemas } from "../../src/tool-schemas.js";
import { RESEARCH_APPEND_SECTIONS } from "../../src/tools/research-append.js";

/**
 * The ownership manifest is the shared declaration of who may write each
 * section of the two project documents. It replaced a pair of dict literals
 * inside a pytest validator — a tier that runs in neither Cowork nor the
 * hosted path, and only inside a paid per-skill eval run even in the harness.
 *
 * **What this file guards is that the declaration is exhaustive and resolvable**,
 * not that any particular skill owns any particular section. The enforced
 * writer sets are frozen separately, by
 * `eval/harness/tests/unit/test_ownership_manifest.py`, so that deleting an
 * owner reddens a test rather than silently widening what is allowed.
 *
 * The exhaustiveness check is keyed on the **union** of three vocabularies,
 * because each of them alone leaves a hole:
 *
 *  - `research.schema.json`'s top-level properties — misses `plan_items`,
 *    which the tool defines and the schema does not.
 *  - `research_append`'s `section` enum — misses `log` (written by
 *    `research_log_append`, which takes no `section` at all) and
 *    `researcher_profile` (which no tool can write).
 *  - `tree-gedcomx.schema.json`'s top-level properties — the second artifact,
 *    whose `sources` section is a different section from research.json's
 *    `sources` with a different writer set. Rows are keyed on the pair.
 *
 * Replayed against the committed corpus before promotion, the gap between the
 * first two vocabularies was the single largest source of wrong denials: four
 * keys existed on one side only, and they accounted for 1,307 of the 1,314
 * no-owner denials.
 */

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, "..", "..");
const projectRoot = join(mcpRoot, "..", "..", "..");
const pluginRoot = join(projectRoot, "packages", "engine", "plugin");

interface OwnershipRow {
  artifact: string;
  section: string;
  owner: string | null;
  reason?: string;
  callers: string[];
  writerTools: string[];
  enforceableAt: string[];
  requires: string;
  failure: string;
  remedy: string;
  override: string;
  notes?: string;
}

const manifest = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "ownership.json"), "utf8"),
) as { version: number; enforcementPlanes: Record<string, string>; rows: OwnershipRow[] };

const researchSchema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "research.schema.json"), "utf8"),
) as { properties: Record<string, unknown> };

const treeSchema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "tree-gedcomx.schema.json"), "utf8"),
) as { properties: Record<string, unknown> };

const rows = manifest.rows;
const key = (r: { artifact: string; section: string }) => `${r.artifact}#${r.section}`;

/** Every (artifact, section) pair that must have exactly one row. */
function expectedKeys(): string[] {
  const research = new Set<string>([
    ...Object.keys(researchSchema.properties),
    ...RESEARCH_APPEND_SECTIONS,
  ]);
  const tree = new Set<string>(Object.keys(treeSchema.properties));
  return [
    ...[...research].map((s) => `research.json#${s}`),
    ...[...tree].map((s) => `tree.gedcomx.json#${s}`),
  ].sort();
}

describe("ownership manifest — exhaustiveness", () => {
  it("has exactly one row per writable section of both project documents", () => {
    const declared = rows.map(key).sort();
    const expected = expectedKeys();

    const missing = expected.filter((k) => !declared.includes(k));
    const extra = declared.filter((k) => !expected.includes(k));

    expect(
      missing,
      "sections with no ownership row — an undeclared section is one nothing can " +
        "reason about, and default-deny on it denies writes that are correct",
    ).toEqual([]);
    expect(
      extra,
      "rows for a section that is in neither schema nor research_append's `section` " +
        "enum — a renamed or deleted section leaves the row behind",
    ).toEqual([]);
  });

  it("has no duplicate (artifact, section) row", () => {
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(key(r), (seen.get(key(r)) ?? 0) + 1);
    const duped = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    expect(duped, "two rows for one section — one of them is dead").toEqual([]);
  });
});

describe("ownership manifest — every row is complete", () => {
  it("carries every required field, non-empty", () => {
    const bad: string[] = [];
    for (const r of rows) {
      for (const field of ["artifact", "section", "requires", "failure", "remedy", "override"] as const) {
        if (typeof r[field] !== "string" || r[field].trim() === "") {
          bad.push(`${key(r)}: ${field} missing or empty`);
        }
      }
      for (const field of ["callers", "writerTools", "enforceableAt"] as const) {
        if (!Array.isArray(r[field])) bad.push(`${key(r)}: ${field} is not an array`);
      }
      if (!("owner" in r)) bad.push(`${key(r)}: no owner field (use null to declare it unowned)`);
    }
    expect(bad).toEqual([]);
  });

  it("gives every unowned row a stated reason", () => {
    // The distinction this holds open is unowned-BY-DECISION versus
    // unowned-by-accident. An invented owner reads as coverage; a null owner
    // with no reason reads as an oversight. Only the pair is honest.
    const bad = rows
      .filter((r) => r.owner === null)
      .filter((r) => typeof r.reason !== "string" || r.reason.trim().length < 40)
      .map((r) => key(r));
    expect(
      bad,
      "a row may declare `owner: null`, but only with a substantive `reason` " +
        "saying why nobody owns it",
    ).toEqual([]);
  });

  it("does not put a reason on an owned row", () => {
    const bad = rows.filter((r) => r.owner !== null && r.reason !== undefined).map((r) => key(r));
    expect(bad, "`reason` explains an absent owner; an owned row states its rule in `requires`").toEqual([]);
  });
});

describe("ownership manifest — every name resolves", () => {
  /** `skill:<name>` → a real skill directory; `agent:<name>` → a real agent file. */
  function resolves(identifier: string): boolean {
    if (identifier.startsWith("skill:")) {
      return existsSync(join(pluginRoot, "skills", identifier.slice(6), "SKILL.md"));
    }
    if (identifier.startsWith("agent:")) {
      return existsSync(join(pluginRoot, "agents", `${identifier.slice(6)}.md`));
    }
    return false;
  }

  it("resolves every owner to a shipped skill or agent", () => {
    // 49 writes in the committed corpus are attributed to
    // `assertion-classification`, a skill that stopped shipping when extraction
    // absorbed it. This is the check that keeps a name like that out of the
    // declaration once it is gone.
    const bad = rows
      .filter((r) => r.owner !== null)
      .filter((r) => !resolves(r.owner as string))
      .map((r) => `${key(r)}: owner '${r.owner}'`);
    expect(
      bad,
      "an owner must be `skill:<dir under packages/engine/plugin/skills>` or " +
        "`agent:<file under packages/engine/plugin/agents>`",
    ).toEqual([]);
  });

  it("resolves every caller to a shipped skill or agent", () => {
    const bad: string[] = [];
    for (const r of rows) {
      for (const c of r.callers) if (!resolves(c)) bad.push(`${key(r)}: caller '${c}'`);
    }
    expect(bad).toEqual([]);
  });

  it("lists a non-null owner among its own callers", () => {
    // `callers` is the set the checks enforce. An owner outside it is a
    // declaration that the owning skill may not write its own section.
    const bad = rows
      .filter((r) => r.owner !== null && !r.callers.includes(r.owner as string))
      .map((r) => `${key(r)}: owner '${r.owner}' not in callers`);
    expect(bad).toEqual([]);
  });

  it("resolves every writer tool to a registered tool name", () => {
    const registered = new Set(allToolSchemas.map((s) => s.name));
    const bad: string[] = [];
    for (const r of rows) {
      for (const t of r.writerTools) {
        if (!registered.has(t)) bad.push(`${key(r)}: writerTool '${t}'`);
      }
    }
    expect(
      bad,
      "a writer tool must be a name in allToolSchemas — a renamed or retired " +
        "tool leaves the remedy text pointing at a call that cannot be made",
    ).toEqual([]);
  });

  it("names only declared enforcement planes", () => {
    const planes = new Set(Object.keys(manifest.enforcementPlanes));
    const bad: string[] = [];
    for (const r of rows) {
      for (const p of r.enforceableAt) {
        if (!planes.has(p)) bad.push(`${key(r)}: enforceableAt '${p}'`);
      }
    }
    expect(bad, `declared planes: ${[...planes].join(", ")}`).toEqual([]);
  });

  it("does not claim a plane for a row with no writers at all", () => {
    // A row nobody may write cannot be enforced: there is no correct call for
    // the check to permit, so claiming a plane overstates coverage.
    const bad = rows
      .filter((r) => r.callers.length === 0 && r.enforceableAt.length > 0)
      .map((r) => key(r));
    expect(bad).toEqual([]);
  });
});
