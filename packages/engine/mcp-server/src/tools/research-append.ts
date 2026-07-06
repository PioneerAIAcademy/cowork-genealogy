// research_append — structured writer for the mutable research.json sections
// (everything except the append-only `log`, which is research_log_append's job).
//
// One tool with a `section` + `op` discriminator. The LLM supplies the analytical
// content; the tool assigns the section's prefix id, stamps tool-owned timestamps,
// enforces supersede-not-delete (no delete op), runs the section invariants as
// preconditions, validates the whole project, and writes research.json atomically.
//
// Phased per docs/specs/research-append-tool-spec.md §7. This file implements
// Phase 1 (sources, assertions, person_evidence) plus the framework; phases 2–3
// extend SECTIONS.

import { join } from "path";
import { readFile } from "fs/promises";
import { validateParsed } from "../validation/validator.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson } from "../utils/project-io.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";

// ─── Section configuration (the per-section table phases 2–3 extend) ─────────

interface SectionConfig {
  /** id prefix, including the trailing underscore (e.g. "src_"). */
  prefix: string;
  /** Tool-owned timestamp stamped on append when the entry omits it. */
  stampTimestamp?: { field: string; kind: "date" | "datetime" };
  /** Nested section: entries live in `<parent>[<param>].<field>` (plan_items). */
  nested?: { parent: string; param: "planId"; field: string };
  /** Singleton object section (e.g. `project`): `op:"update"` shallow-merges
   *  `fields` (restricted to `allowedFields`) onto the object in place — no
   *  array, no id, no append. The tool stamps `stampTimestamp` on every write. */
  singleton?: {
    allowedFields: string[];
    stampTimestamp?: { field: string; kind: "date" | "datetime" };
  };
}

const CREATED_DATE = { field: "created", kind: "date" } as const;

const SECTIONS: Record<string, SectionConfig> = {
  // Phase 1
  sources: { prefix: "src_" },
  assertions: { prefix: "a_" },
  person_evidence: { prefix: "pe_", stampTimestamp: CREATED_DATE },
  // Phase 2
  questions: { prefix: "q_", stampTimestamp: CREATED_DATE },
  plans: { prefix: "pl_", stampTimestamp: CREATED_DATE },
  plan_items: { prefix: "pli_", nested: { parent: "plans", param: "planId", field: "items" } },
  conflicts: { prefix: "c_" },
  hypotheses: { prefix: "h_" },
  // Phase 3
  timelines: { prefix: "t_", stampTimestamp: { field: "generated", kind: "datetime" } },
  proof_summaries: { prefix: "ps_" },
  evaluations: { prefix: "ev_", stampTimestamp: { field: "timestamp", kind: "datetime" } },
  known_holdings: { prefix: "kh_", stampTimestamp: CREATED_DATE },
  // Singleton metadata (one object, not a list): update-only field writes.
  // proof-conclusion sets `project.status: "completed"` here at the end of a
  // GPS cycle; the tool stamps `project.updated` (iso_date).
  project: {
    prefix: "",
    singleton: { allowedFields: ["status"], stampTimestamp: { field: "updated", kind: "date" } },
  },
};

// Section invariants the project validator does NOT already enforce. (It already
// checks conflict competing-counts, hypothesis ruled_out⇒reason, and
// exhaustive-declaration completeness — those are left to validate-before-persist.)
// Each returns error strings on the post-mutation entry; empty = ok.

function conflictInvariants(entry: any): string[] {
  if (entry.status !== "resolved") return [];
  const errs: string[] = [];
  for (const f of ["independence_analysis", "weighing_analysis", "resolution_rationale"]) {
    const v = entry[f];
    if (v === undefined || v === null || v === "") {
      errs.push(`a resolved conflict requires '${f}'`);
    }
  }
  const competing = Array.isArray(entry.competing_assertion_ids) ? entry.competing_assertion_ids : [];
  if (entry.preferred_assertion_id != null && !competing.includes(entry.preferred_assertion_id)) {
    errs.push("preferred_assertion_id must be one of competing_assertion_ids");
  }
  return errs;
}

function planActiveInvariants(entry: any, research: any): string[] {
  if (entry.status !== "active") return [];
  const conflicting = (research.plans ?? []).filter(
    (p: any) => p !== entry && p.question_id === entry.question_id && p.status === "active",
  );
  if (conflicting.length > 0) {
    return [
      `question '${entry.question_id}' already has an active plan (${conflicting[0].id}); supersede it before adding another`,
    ];
  }
  return [];
}

export type ResearchAppendSection = keyof typeof SECTIONS | string;

/** One mutation. The body of a single call, or one element of a batch `ops`. */
export interface ResearchAppendOp {
  section: ResearchAppendSection;
  op: "append" | "update";
  entry?: Record<string, unknown>; // op = append (no id — the tool assigns it)
  entryId?: string; // op = update
  fields?: Record<string, unknown>; // op = update (shallow-merged; id immutable)
  planId?: string; // required for section = "plan_items"
}

export interface ResearchAppendInput {
  projectPath: string;
  // Single-op form — supply section + op plus the relevant per-op fields:
  section?: ResearchAppendSection;
  op?: "append" | "update";
  entry?: Record<string, unknown>;
  entryId?: string;
  fields?: Record<string, unknown>;
  planId?: string;
  // Batch form — supply ops; when present the single-op fields above are ignored.
  // Every op applies to one in-memory document; the tool validates once and
  // writes once (all-or-nothing). Ids assigned earlier in the batch are visible
  // to later ops (the allocators scan the live document).
  ops?: ResearchAppendOp[];
}

interface SingleSuccess {
  ok: true;
  section: string;
  op: "append" | "update";
  entryId: string;
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
interface BatchSuccess {
  ok: true;
  results: { section: string; op: "append" | "update"; entryId: string }[];
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
export type ResearchAppendResult = SingleSuccess | BatchSuccess | { ok: false; errors: string[] };

/** Carries one or more user-facing messages: the single form echoes them
 *  verbatim; the batch form prefixes each with `ops[i]:`. */
class ResearchAppendError extends Error {
  errors: string[];
  constructor(errors: string | string[]) {
    const arr = Array.isArray(errors) ? errors : [errors];
    super(arr.join("; "));
    this.errors = arr;
  }
}

function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new ResearchAppendError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ResearchAppendError(`${filename} is not valid JSON`);
  }
}

/** Next `<prefix>NNN` id (max + 1, zero-padded to 3) for a research section. */
function nextResearchId(entries: any[], prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const e of entries) {
    const m = e && typeof e.id === "string" ? e.id.match(re) : null;
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

interface AppliedOp {
  section: string;
  op: "append" | "update";
  entryId: string;
  /** A settled no-op (e.g. re-declaring an already-exhaustive question): the
   *  document was not mutated, so the caller may skip the write. */
  noop?: boolean;
  warnings?: string[];
}

/** Apply ONE mutation to the in-memory research document. Mutates `research` in
 *  place and returns a descriptor; throws ResearchAppendError on any precondition
 *  failure so a batch aborts before anything is written. Does NOT validate or
 *  persist — the caller validates the whole document once and writes once. */
// The model routinely emits a GedcomX-style date object (`{original, formal}`)
// for a simplified `date` / `standard_date`, which the schema requires to be a
// plain string. The `original` (or `formal`) field IS that string, so normalize
// it at the boundary — a lossless unwrap that keeps a well-formed extraction
// from being rejected over a wrapper the model added. A string/null value, or
// an object without a usable string, passes through untouched (the validator
// then reports the real problem). Mutates `entry` in place.
function normalizeDateFields(entry: Record<string, unknown>): void {
  for (const key of ["date", "standard_date"] as const) {
    const v = entry[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const s = typeof o.original === "string" ? o.original : typeof o.formal === "string" ? o.formal : undefined;
      if (s !== undefined) entry[key] = s;
    }
  }
}

function applyOne(research: any, op: ResearchAppendOp): AppliedOp {
  const section = op.section;
  const config = SECTIONS[section];
  if (!config) {
    throw new ResearchAppendError(
      `section '${section}' is not supported by research_append (supported: ${Object.keys(SECTIONS).join(", ")})`,
    );
  }

  // Singleton sections (e.g. `project`) are a single object, not an array:
  // `op:"update"` shallow-merges allowed fields in place — no id, no append.
  if (config.singleton) {
    if (op.op !== "update") {
      throw new ResearchAppendError(`section '${section}' supports only op 'update' (it is one object, not a list)`);
    }
    if (!op.fields || typeof op.fields !== "object") {
      throw new ResearchAppendError("update requires a `fields` object");
    }
    const target = research[section];
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new ResearchAppendError(`research.json '${section}' is missing or not an object`);
    }
    const allowed = new Set(config.singleton.allowedFields);
    const rejected = Object.keys(op.fields).filter((k) => !allowed.has(k));
    if (rejected.length > 0) {
      throw new ResearchAppendError(
        `field(s) not updatable on '${section}': ${rejected.join(", ")} ` +
          `(allowed: ${config.singleton.allowedFields.join(", ")})`,
      );
    }
    for (const [k, v] of Object.entries(op.fields)) target[k] = v;
    const stamp = config.singleton.stampTimestamp;
    if (stamp) target[stamp.field] = stamp.kind === "date" ? today() : now();
    // a singleton has no entry id — echo the section name
    return { section, op: "update", entryId: section };
  }

  // Resolve the target array and the pool to scan for the next id. Nested
  // sections (plan_items) live under a parent entry (plans[planId].items),
  // and their ids are unique across all parents.
  let array: any[];
  let idPool: any[];
  if (config.nested) {
    if (!op.planId) {
      throw new ResearchAppendError(`section '${section}' requires a 'planId'`);
    }
    const parents = research[config.nested.parent];
    const parent = Array.isArray(parents) ? parents.find((p) => p && p.id === op.planId) : undefined;
    if (!parent) {
      throw new ResearchAppendError(`${config.nested.parent} entry '${op.planId}' not found`);
    }
    if (!Array.isArray(parent[config.nested.field])) parent[config.nested.field] = [];
    array = parent[config.nested.field];
    idPool = (Array.isArray(parents) ? parents : []).flatMap((p: any) =>
      Array.isArray(p?.[config.nested!.field]) ? p[config.nested!.field] : [],
    );
  } else {
    // Initialize an absent optional section (e.g. known_holdings) on first write.
    if (research[section] === undefined) research[section] = [];
    if (!Array.isArray(research[section])) {
      throw new ResearchAppendError(`research.json '${section}' is not an array`);
    }
    array = research[section];
    idPool = array;
  }

  let entryId: string;
  let resultEntry: any;

  if (op.op === "append") {
    const entry = op.entry;
    if (!entry || typeof entry !== "object") {
      throw new ResearchAppendError("append requires an `entry` object");
    }
    if (entry.id !== undefined && entry.id !== null) {
      throw new ResearchAppendError("append `entry` must not carry an id — the tool assigns it");
    }
    entryId = nextResearchId(idPool, config.prefix);
    // Strip any id key before assigning so the spread can never clobber it.
    const rest: Record<string, unknown> = { ...entry };
    delete rest.id;
    const newEntry: Record<string, unknown> = { id: entryId, ...rest };
    normalizeDateFields(newEntry);
    const stamp = config.stampTimestamp;
    if (stamp && newEntry[stamp.field] === undefined) {
      newEntry[stamp.field] = stamp.kind === "date" ? today() : now();
    }
    array.push(newEntry);
    resultEntry = newEntry;
  } else if (op.op === "update") {
    if (!op.entryId) {
      throw new ResearchAppendError("update requires an `entryId`");
    }
    if (!op.entryId.startsWith(config.prefix)) {
      throw new ResearchAppendError(
        `entryId '${op.entryId}' does not match section '${section}' (prefix ${config.prefix})`,
      );
    }
    if (!op.fields || typeof op.fields !== "object") {
      throw new ResearchAppendError("update requires a `fields` object");
    }
    if ("id" in op.fields && op.fields.id !== op.entryId) {
      throw new ResearchAppendError("update `fields` must not change the entry id");
    }
    const existing = array.find((e) => e && e.id === op.entryId);
    if (!existing) {
      throw new ResearchAppendError(`entryId '${op.entryId}' not found in '${section}'`);
    }

    // Questions: re-declaring exhaustiveness on an already-declared question is
    // a no-op — never overwrite a settled GPS Component-1 record. Only when the
    // declaration is the SOLE field being set, so a bundled update that also
    // changes other fields is not silently dropped.
    if (section === "questions" && Object.keys(op.fields).length === 1) {
      const newEd = op.fields.exhaustive_declaration as any;
      if (existing.exhaustive_declaration?.declared === true && newEd?.declared === true) {
        return {
          section,
          op: op.op,
          entryId: op.entryId,
          noop: true,
          warnings: [`question '${op.entryId}' is already exhaustive_declared; no-op`],
        };
      }
    }

    for (const [k, v] of Object.entries(op.fields)) {
      if (k === "id") continue;
      existing[k] = v;
    }
    normalizeDateFields(existing);
    entryId = op.entryId;
    resultEntry = existing;
  } else {
    throw new ResearchAppendError(`unknown op '${op.op}' (expected 'append' or 'update')`);
  }

  // Section invariants the project validator does not already enforce.
  const invariantErrors: string[] = [];
  if (section === "conflicts") invariantErrors.push(...conflictInvariants(resultEntry));
  // One active plan per question — enforced on append OR an update that
  // (re)sets status to "active"; the helper no-ops for non-active entries.
  if (section === "plans") {
    invariantErrors.push(...planActiveInvariants(resultEntry, research));
  }
  if (invariantErrors.length > 0) {
    throw new ResearchAppendError(invariantErrors);
  }

  return { section, op: op.op, entryId };
}

export async function researchAppend(
  input: ResearchAppendInput,
): Promise<ResearchAppendResult> {
  const { projectPath } = input;

  // Recover object/array args the model serialized as JSON strings (see
  // coerceJsonArg) before any shape checks, so a correct-but-stringified batch
  // isn't rejected as "`ops` must be a non-empty array" and driven into a slow
  // one-op-per-call fallback.
  input.ops = coerceJsonArg(input.ops) as ResearchAppendOp[] | undefined;
  input.entry = coerceJsonArg(input.entry) as Record<string, unknown> | undefined;
  input.fields = coerceJsonArg(input.fields) as Record<string, unknown> | undefined;

  try {
    const research = await readJson(projectPath, "research.json");
    const tree = await readJson(projectPath, "tree.gedcomx.json");

    // ─── Batch form: apply every op in-memory, then validate + write once ─────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const applied: AppliedOp[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        try {
          applied.push(applyOne(research, input.ops[i]));
        } catch (e) {
          if (e instanceof ResearchAppendError) {
            // Identify the failing op; nothing has been written.
            return { ok: false, errors: e.errors.map((m) => `ops[${i}]: ${m}`) };
          }
          throw e;
        }
      }
      const opWarnings = applied.flatMap((a) => a.warnings ?? []);
      const anyMutation = applied.some((a) => !a.noop);
      let validationWarnings: string[] = [];
      if (anyMutation) {
        const validation = await validateParsed(research, tree, { projectPath });
        if (!validation.valid) {
          return { ok: false, errors: formatIssues(validation.errors) };
        }
        validationWarnings = formatIssues(validation.warnings);
        await atomicWriteJson(join(projectPath, "research.json"), research);
      }
      return {
        ok: true,
        results: applied.map((a) => ({ section: a.section, op: a.op, entryId: a.entryId })),
        filesWritten: anyMutation ? ["research.json"] : [],
        validation: { valid: true, warnings: [...validationWarnings, ...opWarnings] },
      };
    }

    // ─── Single-op form (behavior unchanged) ─────────────────────────────────
    if (!input.section || !input.op) {
      return { ok: false, errors: ["provide either `ops` (batch) or `section` + `op` (single)"] };
    }
    let applied: AppliedOp;
    try {
      applied = applyOne(research, {
        section: input.section,
        op: input.op,
        entry: input.entry,
        entryId: input.entryId,
        fields: input.fields,
        planId: input.planId,
      });
    } catch (e) {
      if (e instanceof ResearchAppendError) return { ok: false, errors: e.errors };
      throw e;
    }

    if (applied.noop) {
      return {
        ok: true,
        section: applied.section,
        op: applied.op,
        entryId: applied.entryId,
        filesWritten: [],
        validation: { valid: true, warnings: applied.warnings ?? [] },
      };
    }

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }
    await atomicWriteJson(join(projectPath, "research.json"), research);
    return {
      ok: true,
      section: applied.section,
      op: applied.op,
      entryId: applied.entryId,
      filesWritten: ["research.json"],
      validation: { valid: true, warnings: [...formatIssues(validation.warnings), ...(applied.warnings ?? [])] },
    };
  } catch (e) {
    if (e instanceof ResearchAppendError) return { ok: false, errors: e.errors };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchAppendSchema = {
  name: "research_append",
  description:
    "Write a structured entry to a mutable research.json section — append a new " +
    "entry (the tool assigns the id) or update an existing one in place (preserving " +
    "its id; there is no delete — supersede via a status/`superseded_by` field). Use " +
    "this for the analytical sections; use research_log_append for the research log, " +
    "and the merge / tree_edit tools for tree.gedcomx.json.\n" +
    "\n" +
    "Supply the entry in its persisted snake_case shape WITHOUT an id; the tool " +
    "assigns the next `<prefix>NNN`, stamps tool-owned timestamps, validates the " +
    "whole project, and writes research.json atomically. To revise a person_evidence " +
    "link, append the new entry then update the old one's `superseded_by`. Returns a " +
    "compact summary; on a validation failure nothing is written.\n" +
    "\n" +
    "To persist many entries at once (e.g. a record's source + every assertion in one " +
    "step), pass an `ops` array instead of the top-level section/op: each op is " +
    "`{ section, op, entry?/entryId?/fields?, planId? }`. The tool applies all ops to " +
    "one in-memory document, validates ONCE, and writes ONCE — all-or-nothing (on any " +
    "op's failure nothing is written and the error is `ops[i]: <msg>`). Ids assigned by " +
    "an earlier op are visible to later ops, so an assertion may reference a source " +
    "appended earlier in the same batch by its predictable id (e.g. `src_001`); you may " +
    "NOT update an id created earlier in the same batch. Returns `results: [{section, op, " +
    "entryId}]`.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json.",
      },
      section: {
        type: "string",
        enum: [
          "sources",
          "assertions",
          "person_evidence",
          "questions",
          "plans",
          "plan_items",
          "conflicts",
          "hypotheses",
          "timelines",
          "proof_summaries",
          "evaluations",
          "known_holdings",
          "project",
        ],
        description:
          "The research.json section to write. List sections take append/update " +
          "by id; `project` is the singleton metadata object — use op 'update' " +
          'with fields (e.g. {"status": "completed"}); the tool stamps `updated`.',
      },
      op: {
        type: "string",
        enum: ["append", "update"],
        description: "append a new entry (tool assigns the id) or update an existing one by id.",
      },
      entry: {
        type: "object",
        description: "append: the new entry in snake_case, WITHOUT an id (the tool assigns it).",
      },
      entryId: {
        type: "string",
        description: "update: the id of the existing entry to modify (must match the section's prefix).",
      },
      fields: {
        type: "object",
        description: "update: the fields to shallow-merge onto the existing entry (the id is immutable).",
      },
      planId: {
        type: "string",
        description: "Required for section 'plan_items' — the pl_ id of the parent plan to write into.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: apply many mutations in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level section/op/entry/entryId/" +
          "fields/planId are ignored. Use this to persist a whole record at once.",
        items: {
          type: "object",
          properties: {
            section: {
              type: "string",
              enum: [
                "sources",
                "assertions",
                "person_evidence",
                "questions",
                "plans",
                "plan_items",
                "conflicts",
                "hypotheses",
                "timelines",
                "proof_summaries",
                "evaluations",
                "known_holdings",
                "project",
              ],
              description: "The research.json section this op writes.",
            },
            op: { type: "string", enum: ["append", "update"], description: "append (tool assigns id) or update by id." },
            entry: { type: "object", description: "append: the new entry in snake_case, WITHOUT an id." },
            entryId: { type: "string", description: "update: the id of the existing entry to modify." },
            fields: { type: "object", description: "update: fields to shallow-merge (the id is immutable)." },
            planId: { type: "string", description: "Required when section is 'plan_items' — the parent pl_ id." },
          },
          required: ["section", "op"],
        },
      },
    },
    required: ["projectPath"],
  },
};
