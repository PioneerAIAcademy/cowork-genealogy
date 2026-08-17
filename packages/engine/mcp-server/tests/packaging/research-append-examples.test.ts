import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { __testing } from "../../src/tools/research-append-examples.js";
import { RESEARCH_APPEND_SECTIONS } from "../../src/tools/research-append.js";

/**
 * The worked `research_append` examples conform to research.schema.json.
 *
 * These strings are shown to the model attached to a rejection, so a stale one
 * teaches exactly the shape that was just refused — the failure mode is a
 * trial-and-error loop, not an error. The file's own header says its field
 * lists are transcribed from research.schema.json and its enum literals from
 * enums.schema.json; nothing checked either.
 *
 * Both halves are checked here: field NAMES against `properties`/`required`,
 * and every enum-constrained VALUE — nested objects and array items included —
 * against the enum the schema binds that field to. A stale value is the worse
 * of the two failures, since it teaches a value the validator rejects while
 * looking structurally correct.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

const schema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "research.schema.json"), "utf8"),
);
const enumsSchema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "enums.schema.json"), "utf8"),
);

/**
 * A local `#/$defs/…` ref followed one hop into research.schema.json.
 *
 * Without this the walk below stops at the ref and everything under it is
 * unchecked — which is every nested entry type the sections reach by name:
 * `plans.items[]`, `timelines.events[]`, `timelines.gaps[]`.
 */
function resolveRef(sub: any): any {
  if (sub && typeof sub.$ref === "string" && sub.$ref.startsWith("#/$defs/")) {
    return schema.$defs?.[sub.$ref.slice("#/$defs/".length)] ?? sub;
  }
  return sub;
}

/**
 * A subschema's closed value set, following a `$ref` into enums.schema.json.
 *
 * `null` for anything open: the `*_recommended` `$defs` carry `examples`, not
 * `enum`, and are deliberately not constrained.
 */
function closedValues(sub: any): string[] | null {
  sub = resolveRef(sub);
  if (!sub || typeof sub !== "object") return null;
  if (Array.isArray(sub.enum)) return sub.enum as string[];
  const ref = typeof sub.$ref === "string" ? /^enums\.schema\.json#\/\$defs\/(.+)$/.exec(sub.$ref) : null;
  if (ref) {
    const def = enumsSchema.$defs?.[ref[1]];
    if (Array.isArray(def?.enum)) return def.enum as string[];
  }
  // `anyOf: [{ $ref: <enum> }, { type: "null" }]` is how EVERY nullable enum in
  // this schema is written, so without this branch the closed half is invisible
  // and a field like `assertion.date_certainty` goes unchecked entirely.
  const branches = sub.anyOf ?? sub.oneOf;
  if (Array.isArray(branches)) {
    const sets = branches.filter((b: any) => b?.type !== "null").map(closedValues);
    if (sets.length > 0 && sets.every(Boolean)) return sets.flat() as string[];
  }
  return null;
}

/** Every enum-constrained value in `entry` that the schema would reject. */
function enumViolations(value: unknown, sub: any, path: string, out: string[]): void {
  sub = resolveRef(sub);
  if (!sub || typeof sub !== "object") return;
  const allowed = closedValues(sub);
  if (allowed && typeof value === "string" && !allowed.includes(value)) {
    out.push(`${path} = "${value}" — allowed: ${allowed.join(", ")}`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => enumViolations(v, sub.items, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object" && sub.properties) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      enumViolations(v, sub.properties[k], path ? `${path}.${k}` : k, out);
    }
  }
}

/** Writer section → the `$defs` entry describing one of its entries. */
const DEF_FOR: Record<string, string> = {
  sources: "source",
  assertions: "assertion",
  person_evidence: "person_evidence_entry",
  questions: "question",
  plans: "plan",
  plan_items: "plan_item",
  conflicts: "conflict",
  hypotheses: "hypothesis",
  timelines: "timeline",
  proof_summaries: "proof_summary",
  evaluations: "evaluation_entry",
  known_holdings: "known_holding",
  localities: "locality",
};

/**
 * Required keys the examples omit on purpose, because the tool supplies them
 * and *rejects* an entry that carries one. Omitting them is the correct shape
 * to teach.
 */
const TOOL_ASSIGNED: Record<string, string[]> = {
  // The tool assigns every id (research-append.ts rejects an entry with one).
  "*": ["id"],
  // research-append.ts:862 derives the sidecar path and stamps `file_path`;
  // :892 rejects an entry that carries one alongside `verdict`.
  evaluations: ["file_path"],
  // Deliberate, per the file's own header: the composite form supplies
  // `sourceDescription`, which creates the tree's S entry and fills this id.
  sources: ["gedcomx_source_description_id"],
};

const EXAMPLES = __testing.EXAMPLES as Record<string, string>;

describe("research_append worked examples conform to the schema", () => {
  it("every example section maps to a $def", () => {
    const unmapped = Object.keys(EXAMPLES).filter((s) => !DEF_FOR[s]);
    expect(
      unmapped,
      "add the section to DEF_FOR — an unmapped section is silently unchecked",
    ).toEqual([]);
  });

  it("every writable section has an example", () => {
    // Checked against the tool's own section list, not a magic number: the
    // one-way EXAMPLES → DEF_FOR check above cannot see a section that has no
    // example at all, which is how `localities` — writable, and written by
    // locality-guide — went without one. The two SINGLETONS are excluded:
    // `project` has its own PROJECT_EXAMPLE, and `researcher_profile` is
    // likewise an update-only object with no id and no appendable entry, so
    // neither has an EXAMPLES entry or a DEF_FOR mapping.
    const SINGLETONS = new Set(["project", "researcher_profile"]);
    const expected = RESEARCH_APPEND_SECTIONS.filter((s) => !SINGLETONS.has(s)).sort();
    expect(Object.keys(EXAMPLES).sort()).toEqual([...expected]);
  });

  for (const [section, text] of Object.entries(EXAMPLES)) {
    it(section, () => {
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(text);
      } catch (e) {
        expect.fail(`example is not valid JSON: ${(e as Error).message}`);
      }

      const def = schema.$defs[DEF_FOR[section]];
      expect(def, `no $defs.${DEF_FOR[section]}`).toBeDefined();

      const allowed = new Set(Object.keys(def.properties ?? {}));
      const skip = new Set([...(TOOL_ASSIGNED["*"] ?? []), ...(TOOL_ASSIGNED[section] ?? [])]);

      const unknown = Object.keys(entry!).filter((k) => !allowed.has(k));
      const missing = ((def.required ?? []) as string[]).filter(
        (k) => !(k in entry!) && !skip.has(k),
      );

      expect(
        { unknown, missing },
        `${section} example drifted from $defs.${DEF_FOR[section]} — ` +
          `unknown keys are rejected by additionalProperties:false; missing keys ` +
          `are required and not tool-assigned`,
      ).toEqual({ unknown: [], missing: [] });

      const badValues: string[] = [];
      enumViolations(entry!, def, "", badValues);
      expect(
        badValues,
        `${section} example carries a value the schema's enum rejects — the ` +
          `model is shown this attached to a rejection, so it would teach the ` +
          `exact value that was just refused`,
      ).toEqual([]);
    });
  }
});
