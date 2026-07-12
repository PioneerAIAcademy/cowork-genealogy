// tree_correct — the correction/removal half of the tree_edit op split.
//
// Thin module over the shared core in tree-edit.ts (executeTreeOps): identical
// batched-op, id-rule, validate-on-write, and .bak semantics — only the
// admitted op set differs. tree_correct accepts ONLY update_fact, update_name,
// update_person, update_source, and remove; the additive ops (add_*) live in
// tree_edit. The split exists so write authority is allowlist-enforceable:
// a context granted only tree_edit (e.g. the record-extractor agent) is
// structurally unable to rewrite identity or delete evidence (the ut_013
// rename incident). Spec: docs/specs/tree-edit-tool-spec.md
// § "The tree_edit / tree_correct split".

import {
  executeTreeOps,
  CORRECT_OPERATIONS,
  type OpGate,
  type TreeEditInput,
  type TreeEditResult,
} from "./tree-edit.js";

const CORRECT_GATE: OpGate = {
  allowed: new Set<string>(CORRECT_OPERATIONS),
  rejection: (operation) =>
    `tree_correct only corrects or removes — '${operation}' is an additive op; ` +
    "additions live in tree_edit",
};

export type TreeCorrectInput = TreeEditInput;
export type TreeCorrectResult = TreeEditResult;

export async function treeCorrect(input: TreeCorrectInput): Promise<TreeCorrectResult> {
  return executeTreeOps(input, CORRECT_GATE);
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const treeCorrectSchema = {
  name: "tree_correct",
  description:
    "Correct or remove entries in the project's tree.gedcomx.json — update a " +
    "fact, name, person (gender/ark), or source in place, or remove a " +
    "fact/relationship on a tier downgrade. CORRECTIONS/REMOVALS ONLY: " +
    "additions (add_fact/add_name/add_person/add_relationship/add_source) live " +
    "in the tree_edit tool. update_fact targets a person (personId) or an " +
    "existing Couple relationship (relationshipId) — exactly one. remove takes " +
    "exactly one of factId or relationshipId and never deletes a person (use " +
    "merge_tree_persons to collapse duplicates).\n" +
    "\n" +
    "Pick the `operation` and pass ONLY the fields to change (snake_case " +
    "simplified-GedcomX; ids are immutable). The tool swaps the " +
    "primary/preferred flag, re-resolves standard_place on a place change, " +
    "validates the whole project, and writes only tree.gedcomx.json (with a " +
    "one-deep .bak). On a validation failure nothing is written and " +
    "`{ ok: false, errors }` is returned. Run check-warnings after for " +
    "genealogical-plausibility checks.\n" +
    "\n" +
    "To make several corrections at once, pass an `ops` array instead of the " +
    "top-level operation: each op is `{ operation, ...fields }` (the same " +
    "per-op fields). The tool applies all ops to one in-memory tree, validates " +
    "ONCE, and writes ONCE — all-or-nothing (on any op's failure nothing is " +
    "written and the error is `ops[i]: <msg>`).",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      operation: {
        type: "string",
        enum: [
          "update_fact",
          "update_name",
          "update_person",
          "update_source",
          "remove",
        ],
        description: "The correction/removal to perform. Additions: use tree_edit.",
      },
      personId: {
        type: "string",
        description:
          "Target person id — for update_fact (person-held facts; exactly one of personId or " +
          "relationshipId), update_name, update_person.",
      },
      factId: { type: "string", description: "Target fact id — for update_fact and remove." },
      nameId: { type: "string", description: "Target name id — for update_name." },
      relationshipId: {
        type: "string",
        description:
          "Target relationship id — for update_fact on a Couple relationship's own facts " +
          "(exactly one of personId or relationshipId), and for remove.",
      },
      sourceId: { type: "string", description: "Target source id — for update_source." },
      fact: {
        type: "object",
        description:
          "update_fact: the fields to set (id immutable). date/standard_date/place/" +
          "standard_place/value are plain strings (date: \"2 October 1876\"), never nested objects. " +
          "Set `primary: true` to make it the primary of its type.",
      },
      name: {
        type: "object",
        description: "update_name: the fields to set (id immutable). Set `preferred: true` to make it the preferred name.",
      },
      source: {
        type: "object",
        description: "update_source: the fields to set (id immutable). Fields: `title`, `author`, `url`, `citation` — the lightweight tree sources[] entry, distinct from the rich research.json source.",
      },
      gender: { type: "string", description: "update_person: new gender (Male/Female/Unknown)." },
      ark: { type: "string", description: "update_person: the FamilySearch ARK to set." },
      resolveStandardPlace: {
        type: "boolean",
        description: "Default true: auto-resolve standard_place when a fact place is set. Pass false to skip the lookup.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many corrections in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level operation/fields are ignored. " +
          "Each op is the same `{ operation, ...fields }` the single form takes.",
        items: {
          type: "object",
          properties: {
            operation: {
              type: "string",
              enum: [
                "update_fact",
                "update_name",
                "update_person",
                "update_source",
                "remove",
              ],
              description: "The correction/removal to perform. Additions: use tree_edit.",
            },
            personId: { type: "string" },
            factId: { type: "string" },
            nameId: { type: "string" },
            relationshipId: { type: "string" },
            sourceId: { type: "string" },
            fact: { type: "object" },
            name: { type: "object" },
            source: { type: "object" },
            gender: { type: "string" },
            ark: { type: "string" },
            resolveStandardPlace: { type: "boolean" },
          },
          required: ["operation"],
        },
      },
    },
    required: ["projectPath"],
  },
};
