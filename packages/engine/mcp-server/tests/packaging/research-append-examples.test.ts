import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { __testing } from "../../src/tools/research-append-examples.js";

/**
 * The worked `research_append` examples conform to research.schema.json.
 *
 * These strings are shown to the model attached to a rejection, so a stale one
 * teaches exactly the shape that was just refused — the failure mode is a
 * trial-and-error loop, not an error. The file's own header says its field
 * lists are transcribed from research.schema.json and its enum literals from
 * enums.schema.json; nothing checked either.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..", "..", "..", "..", "..");

const schema = JSON.parse(
  readFileSync(join(projectRoot, "docs", "specs", "schemas", "research.schema.json"), "utf8"),
);

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

  it("checks a plausible number of examples", () => {
    expect(Object.keys(EXAMPLES).length).toBeGreaterThan(10);
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
    });
  }
});
