import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { __testing, exampleFor } from "../../src/tools/research-append-examples.js";
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

/**
 * Required keys the examples omit because ANOTHER OP IN THE SAME CALL supplies
 * them — distinct from `TOOL_ASSIGNED`, where the tool fills the field itself.
 *
 * A `plans` shell omits `items` and the `plan_items` ops in the same batched
 * call create them, which is what `research-plan/SKILL.md` prescribes and what
 * `exampleFor("plans")` now renders. Naming this separately matters: calling it
 * tool-assigned would be false, and the false version is what makes a reader
 * think a standalone `plans` append is legal — the belief that put `"items":
 * []` in this example in the first place.
 */
const BATCH_SUPPLIED: Record<string, string[]> = {
  plans: ["items"],
};

/**
 * Every array in `entry` shorter than its subschema's `minItems`.
 *
 * A `minItems` violation is the failure that shipped: `plans` taught
 * `"items": []`, the field-name and enum checks both passed it, and the model
 * copied it into a document `research.schema.json` rejects.
 *
 * Conditional subschemas are EVALUATED, not skipped. All four `minItems` in
 * this schema but one live inside `allOf[].if/then` (`log_entry_ids` when
 * `declared: true`, `competing_assertion_ids` by `conflict_type`), so a walk
 * that ignored them would — now that `plans` legitimately omits `items` — check
 * zero constraints across all 13 examples while still reading as coverage.
 * Applying a `then` WITHOUT its `if` is the other wrong answer: it would
 * false-flag the `questions` example, which correctly shows `log_entry_ids: []`
 * on an undeclared question. So the `if` is tested first, and only the
 * `const`/`enum`-on-a-property form this schema actually uses is supported —
 * an `if` shaped any other way is skipped rather than guessed at.
 */
function conditionApplies(cond: any, value: any): boolean {
  if (!cond || typeof cond !== "object" || !cond.properties) return false;
  for (const [k, want] of Object.entries<any>(cond.properties)) {
    const actual = (value ?? {})[k];
    if ("const" in want) {
      if (actual !== want.const) return false;
    } else if (Array.isArray(want.enum)) {
      if (!want.enum.includes(actual)) return false;
    } else {
      return false; // an unsupported `if` shape: skip rather than guess
    }
  }
  return true;
}

function minItemsViolations(value: unknown, sub: any, path: string, out: string[]): void {
  sub = resolveRef(sub);
  if (!sub || typeof sub !== "object") return;
  if (Array.isArray(value)) {
    if (typeof sub.minItems === "number") {
      minItemsChecked += 1;
      if (value.length < sub.minItems) {
        out.push(`${path} has ${value.length} item(s), schema requires minItems ${sub.minItems}`);
      }
    }
    value.forEach((v, i) => minItemsViolations(v, sub.items, `${path}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const branch of Array.isArray(sub.allOf) ? sub.allOf : []) {
      if (branch?.then && conditionApplies(branch.if, value)) {
        minItemsViolations(value, branch.then, path, out);
      }
    }
    if (sub.properties) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        minItemsViolations(v, sub.properties[k], path ? `${path}.${k}` : k, out);
      }
    }
  }
}

/** How many `minItems` constraints the walk actually EVALUATED, counted BY the
 *  walk itself rather than by a second traversal. A parallel counter cannot
 *  witness the real walk going vacuous: the first draft of this guard kept its
 *  own copy of the conditional descent, so deleting the descent from
 *  `minItemsViolations` left the count untouched and every test still green. */
let minItemsChecked = 0;
/** How many per-section example tests actually executed. The vacuity assertion
 *  below is meaningless when a name filter skipped them all, and asserting
 *  anyway made `vitest -t "<other name>"` fail on a healthy tree. */
let sectionsWalked = 0;

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
      const skip = new Set([
        ...(TOOL_ASSIGNED["*"] ?? []),
        ...(TOOL_ASSIGNED[section] ?? []),
        ...(BATCH_SUPPLIED[section] ?? []),
      ]);

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

      sectionsWalked += 1;
      const short: string[] = [];
      minItemsViolations(entry!, def, "", short);
      expect(
        short,
        `${section} example carries an array the schema's minItems rejects — it ` +
          `looks structurally correct and validates in neither schema, so a caller ` +
          `shown it on a rejection copies it and is refused again`,
      ).toEqual([]);

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

describe("the minItems walk is not vacuous", () => {
  it("evaluated at least one minItems constraint across the examples", () => {
    // Ordering: vitest collects every `it` before running any, and this suite is
    // declared after the per-section loop, so the counter is populated by the
    // time this assertion runs.
    if (sectionsWalked === 0) return; // a name filter skipped the per-section tests
    expect(
      minItemsChecked,
      "the minItems walk reached no constraint at all — it passes for the wrong " +
        "reason and reads as coverage. Check that conditional subschemas are " +
        "still being evaluated (conditionApplies).",
    ).toBeGreaterThan(0);
  });
});

describe("the rendered plan examples teach a call the tool accepts", () => {
  /**
   * The registry entries above are checked against the schema; these two check
   * what a caller is actually SHOWN, which is `exampleFor`'s output. Both
   * failures being guarded here were in that output and in nothing else: the
   * `plans` example rendered a standalone append the tool refuses, and the
   * `plan_items` example hard-coded the one plan id `research-plan/SKILL.md`
   * says never to hard-code.
   */
  /** The rendered call with its `//` commentary removed. A guard on the call
   *  must read the call: matched against the raw text, the first draft of the
   *  empty-array assertion below failed on the comment that warns against it. */
  const callOnly = (text: string) =>
    text
      .split("\n")
      // Whole-line AND trailing comments. Stripping only whole-line ones left a
      // trap: a trailing `// never write "items": []` would be read as part of
      // the call and false-flag the guard, which is the same confusion between
      // prose and code that the first draft of this assertion made.
      .map((line) => line.replace(/^\s*\/\/.*$/, "").replace(/\s*\/\/.*$/, ""))
      .join("\n");

  it("`plans` renders the batched call, not a standalone append", () => {
    const ex = exampleFor("plans", "append") ?? "";
    expect(ex).toContain("ops: [");
    expect(ex).toContain('section: "plan_items"');
    // The shape that persisted a schema-invalid document.
    expect(callOnly(ex)).not.toMatch(/"items"\s*:\s*\[\s*\]/);
  });

  it("`plan_items` does not hard-code pl_001 as the parent plan", () => {
    // A hard-coded pl_001 attaches the items to whatever plan happens to be
    // first in an ongoing project — another question's, in the observed case.
    expect(callOnly(exampleFor("plan_items", "append") ?? "")).not.toContain('planId: "pl_001"');
    expect(callOnly(exampleFor("plan_items", "update") ?? "")).not.toContain('planId: "pl_001"');
    // and it says how to work the id out
    expect(exampleFor("plan_items", "append") ?? "").toMatch(/highest existing pl_/);
  });

  it("every rendered append example is the call shape its section requires", () => {
    // A one-way guard against the reverse mistake: a section whose example
    // needs the batch form silently reverting to the single-op form. `plans` is
    // the only such section today; naming it here is what makes a future
    // change to `exampleFor` visible.
    const BATCH_ONLY = new Set(["plans"]);
    for (const section of Object.keys(EXAMPLES)) {
      const ex = exampleFor(section, "append") ?? "";
      expect(ex.includes("ops: ["), `${section} append example`).toBe(BATCH_ONLY.has(section));
    }
  });
});
