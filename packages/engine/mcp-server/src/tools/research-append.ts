// research_append — structured writer for the mutable research.json sections
// (everything except the append-only `log`, which is research_log_append's job).
//
// One tool with a `section` + `op` discriminator. The LLM supplies the analytical
// content; the tool assigns the section's prefix id, stamps tool-owned timestamps,
// enforces supersede-not-delete (no delete op), runs the section invariants as
// preconditions, validates the whole project, and writes research.json atomically.
//
// Composite persist (D1, record-extraction consolidation): an optional top-level
// `sourceDescription` lets one call persist a whole record — the tool creates the
// tree.gedcomx.json `S` entry via the shared write layer, stamps the sources op's
// `gedcomx_source_description_id`, auto-stamps assertion `source_id`s, enforces
// the persona/record-id matrix against the log entry's sidecar (D2), resolves
// `standard_place` (sidecar copy first), and commits BOTH documents together
// (tree first, then research).
//
// Phased per docs/specs/research-append-tool-spec.md §7; SECTIONS now covers
// all three phases (sources/assertions/person_evidence, the status-transition
// sections, the phase-3 sections, and the `project` singleton).

import { join } from "path";
import { readFile } from "fs/promises";
import { validateParsed } from "../validation/validator.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import type { ValidationError } from "../validation/types.js";
import {
  atomicWriteJson,
  atomicWriteBoth,
  backupIfExists,
  isInsideProject,
} from "../utils/project-io.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { arkToBareId } from "../utils/ark.js";
import { resolveStandardPlace } from "../utils/place-resolver.js";
import { stdDate } from "../utils/date-standardize.js";
import { MONTH_NUM } from "../utils/date-constants.js";
import type { SimplifiedGedcomX } from "../types/gedcomx.js";

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

/** The tree `S` entry payload for the composite persist. camelCase param at the
 *  boundary; the payload keys are exactly the simplified-GedcomX source fields. */
export interface SourceDescriptionInput {
  title: string;
  author?: string;
  url?: string;
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
  // Composite persist: create the tree.gedcomx.json `S` entry for this call's
  // single sources append op and stamp its `gedcomx_source_description_id`.
  sourceDescription?: SourceDescriptionInput;
  // Default true: auto-resolve standard_place for an assertion append that has a
  // `place` but omits `standard_place` (sidecar copy first, then geocoding).
  // Pass false to skip the geocoding network call (sidecar copy still applies).
  resolveStandardPlace?: boolean;
}

/** A place the tool resolved (echoed so the caller can sanity-check geocoding
 *  without re-reading files). `source` says where the value came from. */
export interface ResolvedPlaceEcho {
  place: string;
  standardPlace: string;
  source: "sidecar" | "geocoded";
}

/** The §3.4.1 source-reuse decision, echoed whenever auto-detection engaged
 *  so the caller can relay it without re-reading files. */
export interface SourceReuseEcho {
  action: "created" | "updated_existing" | "new_source_reused_s";
  /** The research source the batch wrote (existing id, or the assigned src_NNN). */
  srcId: string;
  /** The tree S entry that source cites. */
  sId: string | null;
}

interface SingleSuccess {
  ok: true;
  section: string;
  op: "append" | "update";
  entryId: string;
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces?: ResolvedPlaceEcho[];
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
interface BatchSuccess {
  ok: true;
  results: { section: string; op: "append" | "update"; entryId: string }[];
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces?: ResolvedPlaceEcho[];
  filesWritten: string[];
  validation: { valid: true; warnings: string[] };
}
export type ResearchAppendResult =
  | SingleSuccess
  | BatchSuccess
  | { ok: false; errors: string[]; opsReceived?: number };

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
  /** Top-level array index of the touched entry (append or update) for
   *  mapping whole-document validation errors back to the op that caused
   *  them. Absent for nested (plan_items) and singleton sections. */
  arrayIndex?: number;
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DD_MON_YYYY_RE = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/;

/** Convert a human-written date to ISO `YYYY-MM-DD`, or null if it can't be
 *  resolved unambiguously to a full day. Reuses the genealogical `stdDate`
 *  standardizer (handles i18n month names, `July 12, 2026`, dashed forms, etc.),
 *  which yields a canonical `DD Mon YYYY`; a form without a day (`Jul 2026`) or a
 *  range/modifier does not match and returns null. */
function humanDateToIso(raw: string): string | null {
  if (ISO_DATE_RE.test(raw)) return raw;
  const m = DD_MON_YYYY_RE.exec(stdDate(raw));
  if (!m) return null;
  const monNum = MONTH_NUM.get(m[2]);
  if (monNum === undefined) return null;
  return `${m[3]}-${String(monNum).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Normalize a source's `access_date` to ISO in place. The schema requires ISO
 *  `YYYY-MM-DD`; models routinely supply a human form (`12 July 2026`), which is
 *  persisted verbatim and then hard-fails the JSON-Schema validator. Rewrite a
 *  parseable human date to ISO; leave an ISO/absent/non-string value untouched,
 *  and leave an unparseable value in place so the joint validator reports the
 *  real problem (a rejection the caller can then correct) rather than the tool
 *  silently inventing a date. Only sources carry `access_date`, so this is a
 *  no-op for every other section. */
function normalizeAccessDate(entry: Record<string, unknown>): void {
  const v = entry.access_date;
  if (typeof v !== "string" || ISO_DATE_RE.test(v)) return;
  const iso = humanDateToIso(v);
  if (iso) entry.access_date = iso;
}

/** Canonical assertion `fact_type` spellings, plus the common non-canonical
 *  forms the model emits, keyed by a *normalized comparison form* (lowercased,
 *  every non-alphanumeric character stripped) so casing/underscore/camelCase
 *  variants all collapse to one key: `Cause of Death`, `cause_of_death`, and
 *  `CauseOfDeath` all key on `causeofdeath`.
 *
 *  `fact_type` is an OPEN enum (`fact_type_recommended` in enums.schema.json),
 *  so this is a best-effort *translator*, NOT a closed allow-list: a value whose
 *  normalized key is not present passes through UNCHANGED (an unrecognized fact
 *  type is legal, just left un-normalized). Two things this buys us that the
 *  eval validator's own casefolding cannot: (1) mapping *semantic* aliases the
 *  casefold can't reach — `father_name`→`name`, `parentage`→`relationship` —
 *  and (2) one canonical spelling in the persisted file for downstream skills
 *  and the judge.
 *
 *  Event place/date are ATTRIBUTES of the event fact, not their own fact types
 *  (matching the tree + GedcomX, which have no `Birthplace`/`Deathplace` type —
 *  birthplace is the `place` of a `Birth` fact). So a place-of-event variant is
 *  folded into the event type — `birthplace`/`place_of_birth` → `birth`,
 *  `deathplace` → `death` — and `PLACE_VARIANT_KEYS` (below) additionally lifts
 *  the place VALUE into the machine-readable `place` field so the folded
 *  assertion is distinguishable from the event's date-claim by field population
 *  (`place != null` = the place-claim, `date != null` = the date-claim). This
 *  keeps birthplace and birth-date *independently classifiable* as separate
 *  `birth` assertions (census: a `direct` place-claim + an `indirect`
 *  computed-year claim) while giving downstream code one grouping key per event.
 *  `sex`/`gender` stay distinct — a model mislabeling those is a content error
 *  we surface, not silently "correct". */
const FACT_TYPE_ALIASES: Record<string, string> = {
  // name — plus the role-prefixed variants the model emits when it folds
  // "whose name" into the fact_type instead of leaving it to the record_role
  // (father_name on a father_of_deceased role → just `name`).
  name: "name",
  fathername: "name",
  mothername: "name",
  parentname: "name",
  spousename: "name",
  maidenname: "name",
  fullname: "name",
  givenname: "name",
  age: "age",
  // birth EVENT — date and place are attributes of the one `birth` fact, so the
  // place variants fold in here and PLACE_VARIANT_KEYS lifts the place value.
  birth: "birth",
  birthdate: "birth",
  dateofbirth: "birth",
  birthplace: "birth",
  placeofbirth: "birth",
  residence: "residence",
  occupation: "occupation",
  // relationship — plus the bare-structure aliases the model reaches for.
  relationship: "relationship",
  parentage: "relationship",
  familycomposition: "relationship",
  gender: "gender",
  sex: "sex",
  race: "race",
  // death / burial / christening EVENTS — place variants fold into the event.
  death: "death",
  deathdate: "death",
  dateofdeath: "death",
  deathplace: "death",
  placeofdeath: "death",
  causeofdeath: "cause_of_death",
  durationofillness: "duration_of_illness",
  burial: "burial",
  burialplace: "burial",
  placeofburial: "burial",
  christening: "christening",
  christeningplace: "christening",
  baptism: "christening",
  marriage: "marriage",
  marriagelicense: "marriage",
};

/** Normalized keys of the place-of-event fact_type variants. When the model
 *  labels an assertion with one of these, `canonicalizeAssertionLabels` folds
 *  the type into the event (via FACT_TYPE_ALIASES) AND lifts the place value
 *  into the `place` field if it is not already there — so the machine-readable
 *  place survives the fold and the assertion reads as the event's place-claim. */
const PLACE_VARIANT_KEYS = new Set([
  "birthplace",
  "placeofbirth",
  "deathplace",
  "placeofdeath",
  "burialplace",
  "placeofburial",
  "christeningplace",
]);

/** Reduce a label to its normalized comparison key: lowercase, then drop every
 *  non-alphanumeric character. */
function labelKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isBlank(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "";
}

/** Best-effort canonicalization of an assertion's `fact_type` in place. Maps a
 *  known alias (by normalized key) to its canonical spelling, and folds a
 *  place-of-event variant into the event type while lifting its place value into
 *  the `place` field (see the doc comment on FACT_TYPE_ALIASES). Leaves an
 *  unrecognized value untouched (open enum). No-op for a non-assertion entry
 *  (only assertions carry `fact_type`) or a non-string value. */
function canonicalizeAssertionLabels(entry: Record<string, unknown>): void {
  const ft = entry.fact_type;
  if (typeof ft !== "string") return;
  const key = labelKey(ft);
  const canonical = FACT_TYPE_ALIASES[key];
  if (canonical) entry.fact_type = canonical;
  // A folded place-of-event variant must keep its place machine-readable: if
  // neither `place` nor `standard_place` is set, lift the human `value` (which
  // for a place-claim IS the place string, e.g. "Ireland") into `place`.
  if (PLACE_VARIANT_KEYS.has(key) && isBlank(entry.place) && isBlank(entry.standard_place) && !isBlank(entry.value)) {
    entry.place = entry.value;
  }
}

function applyOne(research: any, op: ResearchAppendOp, appendedThisBatch?: Set<string>): AppliedOp {
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
  let arrayIndex: number | undefined;

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
    normalizeAccessDate(newEntry);
    canonicalizeAssertionLabels(newEntry);
    const stamp = config.stampTimestamp;
    if (stamp && newEntry[stamp.field] === undefined) {
      newEntry[stamp.field] = stamp.kind === "date" ? today() : now();
    }
    array.push(newEntry);
    if (!config.nested) arrayIndex = array.length - 1;
    appendedThisBatch?.add(entryId);
    resultEntry = newEntry;
  } else if (op.op === "update") {
    if (!op.entryId) {
      throw new ResearchAppendError("update requires an `entryId`");
    }
    // §3.3: a later op may reference an id created earlier in the batch, but
    // may NOT update it — `append` assigns the id internally, so naming it for
    // an in-batch update means the caller predicted it. Do that update in a
    // follow-up call.
    if (appendedThisBatch?.has(op.entryId)) {
      throw new ResearchAppendError(
        `entryId '${op.entryId}' was appended earlier in this batch — updates to an id created in the same batch are not allowed; make the update in a follow-up call`,
      );
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
    const existingIndex = array.findIndex((e) => e && e.id === op.entryId);
    if (existingIndex === -1) {
      throw new ResearchAppendError(`entryId '${op.entryId}' not found in '${section}'`);
    }
    const existing = array[existingIndex];
    if (!config.nested) arrayIndex = existingIndex;

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
    normalizeAccessDate(existing);
    canonicalizeAssertionLabels(existing);
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

  return { section, op: op.op, entryId, arrayIndex };
}

// ─── Composite persist + enforcement pre-pass ───────────────────────────────

/** Country-token guard for the wrong-geocode theme. Small, conservative alias
 *  map: only when the assertion's own place TEXT ends in a recognized country
 *  can a contradiction be declared. */
const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "united states",
  "united states of america": "united states",
  usa: "united states",
  us: "united states",
  america: "united states",
  "united kingdom": "united kingdom",
  uk: "united kingdom",
  "great britain": "united kingdom",
  england: "england",
  scotland: "scotland",
  wales: "wales",
  "northern ireland": "northern ireland",
  ireland: "ireland",
  canada: "canada",
  australia: "australia",
  "new zealand": "new zealand",
  germany: "germany",
  france: "france",
  norway: "norway",
  sweden: "sweden",
  denmark: "denmark",
  netherlands: "netherlands",
  holland: "netherlands",
  belgium: "belgium",
  italy: "italy",
  spain: "spain",
  portugal: "portugal",
  poland: "poland",
  russia: "russia",
  austria: "austria",
  hungary: "hungary",
  switzerland: "switzerland",
  mexico: "mexico",
};

const UK_CONSTITUENTS = new Set(["england", "scotland", "wales", "northern ireland"]);

function canonicalCountry(segment: string): string | null {
  const norm = segment.trim().toLowerCase().replace(/\./g, "");
  return COUNTRY_ALIASES[norm] ?? null;
}

function placeSegments(place: string): string[] {
  return place
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Compare the country the place TEXT names (its trailing token, when that token
 * is a recognized country) against the standard_place's segments.
 * - "ok": the input names a country and the standard place is consistent.
 * - "contradiction": the input names a country the standard place plainly lacks.
 * - "unverifiable": the input text names no recognized country — cannot compare.
 */
export function countryConsistency(place: string, standardPlace: string): "ok" | "contradiction" | "unverifiable" {
  const inputSegs = placeSegments(place);
  if (inputSegs.length === 0) return "unverifiable";
  const inputCountry = canonicalCountry(inputSegs[inputSegs.length - 1]);
  if (!inputCountry) return "unverifiable";

  const stdCountries = placeSegments(standardPlace)
    .map(canonicalCountry)
    .filter((c): c is string => c !== null);
  if (stdCountries.includes(inputCountry)) return "ok";
  // UK constituents: "England" is consistent with a standard place that ends in
  // "United Kingdom" — unless a DIFFERENT constituent is present.
  if (UK_CONSTITUENTS.has(inputCountry)) {
    if (stdCountries.some((c) => UK_CONSTITUENTS.has(c) && c !== inputCountry)) return "contradiction";
    if (stdCountries.includes("united kingdom")) return "ok";
  }
  // Historic Irish records: "Ireland" is consistent with "Northern Ireland".
  if (inputCountry === "ireland" && stdCountries.includes("northern ireland")) return "ok";
  return "contradiction";
}

/** Find a converter-resolved standard_place inside a sidecar record's
 *  simplified gedcomx whose fact `place` matches `place` (trimmed,
 *  case-insensitive). Never geocode what the source record already resolved. */
function sidecarStandardPlace(gx: any, place: string): string | null {
  if (!gx || typeof gx !== "object") return null;
  const want = place.trim().toLowerCase();
  const factLists: any[][] = [];
  for (const p of Array.isArray(gx.persons) ? gx.persons : []) {
    if (p && Array.isArray(p.facts)) factLists.push(p.facts);
  }
  for (const r of Array.isArray(gx.relationships) ? gx.relationships : []) {
    if (r && Array.isArray(r.facts)) factLists.push(r.facts);
  }
  for (const facts of factLists) {
    for (const f of facts) {
      if (
        f &&
        typeof f.place === "string" &&
        f.place.trim().toLowerCase() === want &&
        typeof f.standard_place === "string" &&
        f.standard_place.length > 0
      ) {
        return f.standard_place;
      }
    }
  }
  return null;
}

interface PreparedOps {
  treeMutated: boolean;
  sourceDescriptionId?: string;
  sourceReuse?: SourceReuseEcho;
  resolvedPlaces: ResolvedPlaceEcho[];
  warnings: string[];
}

/** Normalized-exact repository comparison key (trim + casefold). */
function normalizeRepository(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/**
 * The composite/enforcement pre-pass. Runs BEFORE the apply loop, mutating the
 * in-memory `tree` (S entry) and the ops' entries (stamps, auto-fills,
 * canonicalizations) in place. Collects every op-scoped error (all failing ops
 * are named at once) and throws a single ResearchAppendError when any exist.
 *
 * 0. Source-reuse auto-detection (§3.4.1): when the batch's assertion appends
 *    cite a `record_id` an existing research source already covers, convert
 *    the sources append into an update of that source (same repository) or
 *    stamp the existing S id onto it (different repository) — either way the
 *    S-create is skipped and the decision is echoed as `sourceReuse`.
 * 1. `sourceDescription` → create the tree `S` entry (shared id allocator) and
 *    stamp the batch's single sources append op's `gedcomx_source_description_id`.
 * 2. Every sources append op must reference an S entry that exists (created in
 *    step 1 or pre-existing — the multi-repository reuse pattern). Op-level
 *    precondition, NOT a document-validator rule.
 * 3. Auto-stamp `source_id`: exactly one sources append op in the batch → every
 *    assertions append op that omits `source_id` gets its (deterministic) id.
 * 4. D2 persona/record-id matrix per assertions append op (see spec §3.5).
 * 5. Place levers: sidecar-copy-first standard_place resolution + geocoding,
 *    and the country-contradiction guard.
 */
async function prepareOps(
  input: ResearchAppendInput,
  ops: ResearchAppendOp[],
  research: any,
  tree: SimplifiedGedcomX,
  projectPath: string,
  fmt: (i: number, msg: string) => string,
): Promise<PreparedOps> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resolvedPlaces: ResolvedPlaceEcho[] = [];
  let treeMutated = false;
  let sourceDescriptionId: string | undefined;
  let sourceReuse: SourceReuseEcho | undefined;

  const findSourcesAppends = (): number[] =>
    ops
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => op.section === "sources" && op.op === "append")
      .map(({ i }) => i);
  let sourcesAppendIdx = findSourcesAppends();

  // ── 0. Source-reuse auto-detection (§3.4.1) ──
  // Engages only for the composite record-persist shape: exactly one sources
  // append with NO explicit S reference (a caller-supplied
  // gedcomx_source_description_id keeps the verified-reuse semantics and is
  // never second-guessed), plus at least one assertions append carrying a
  // record_id. Record ids compare canonicalized (arkToBareId), repositories
  // by normalized exact match (trim + casefold).
  let reuseSkipsSourceDescription = false;
  let detectionEngaged = false;
  const assertionAppends = ops.filter(
    (op) => op.section === "assertions" && op.op === "append" && op.entry && typeof op.entry === "object",
  );
  if (sourcesAppendIdx.length === 1) {
    const srcOp = ops[sourcesAppendIdx[0]];
    const srcEntry = srcOp.entry as any;
    const batchRecordKeys = new Set(
      assertionAppends
        .map((op) => (op.entry as any).record_id)
        .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "")
        .map((v: string) => arkToBareId(v)),
    );
    if (
      srcEntry &&
      typeof srcEntry === "object" &&
      srcEntry.gedcomx_source_description_id == null &&
      batchRecordKeys.size > 0
    ) {
      detectionEngaged = true;
      // Existing sources covering any of the batch's record ids, in
      // research.sources array order (deterministic "first match").
      const sourceIdsForRecords = new Set<string>();
      for (const a of Array.isArray(research.assertions) ? research.assertions : []) {
        if (
          a &&
          typeof a.record_id === "string" &&
          typeof a.source_id === "string" &&
          batchRecordKeys.has(arkToBareId(a.record_id))
        ) {
          sourceIdsForRecords.add(a.source_id);
        }
      }
      const matched = (Array.isArray(research.sources) ? research.sources : []).filter(
        (s: any) => s && typeof s === "object" && sourceIdsForRecords.has(s.id),
      );
      if (matched.length > 0) {
        const wantRepo = normalizeRepository(srcEntry.repository);
        const sameRepo =
          wantRepo !== "" ? matched.find((s: any) => normalizeRepository(s.repository) === wantRepo) : undefined;
        if (sameRepo) {
          // Same record + same repository → refine the existing source in
          // place instead of duplicating it. The append becomes an update;
          // the existing S link is kept (never overwritten by the merge).
          const fields: Record<string, unknown> = { ...srcEntry };
          delete fields.id;
          delete fields.gedcomx_source_description_id;
          ops[sourcesAppendIdx[0]] = { section: "sources", op: "update", entryId: sameRepo.id, fields };
          // The step-3 auto-stamp requires a sources APPEND, which no longer
          // exists — stamp the batch's assertions with the existing id here.
          for (const op of assertionAppends) {
            const e = op.entry as any;
            if (e.source_id === undefined || e.source_id === null) e.source_id = sameRepo.id;
          }
          sourceReuse = {
            action: "updated_existing",
            srcId: sameRepo.id,
            sId: typeof sameRepo.gedcomx_source_description_id === "string" ? sameRepo.gedcomx_source_description_id : null,
          };
          reuseSkipsSourceDescription = true;
          sourcesAppendIdx = findSourcesAppends();
        } else {
          // Same record, different repository → new research source, but the
          // record's S entry already exists: reuse the first match's S and
          // skip the S-create even when sourceDescription was supplied.
          const reusedS = matched
            .map((s: any) => s.gedcomx_source_description_id)
            .find((v: unknown): v is string => typeof v === "string" && v !== "");
          if (reusedS !== undefined) {
            srcEntry.gedcomx_source_description_id = reusedS;
            sourceReuse = {
              action: "new_source_reused_s",
              srcId: nextResearchId(Array.isArray(research.sources) ? research.sources : [], "src_"),
              sId: reusedS,
            };
            reuseSkipsSourceDescription = true;
          }
          // A legacy matched source with no S id falls through to the
          // created path (sourceDescription, when present, creates the S).
        }
      }
    }
  }

  // ── 1. sourceDescription → tree S entry ──
  // Ignored (not validated) when §3.4.1 already resolved the source's S —
  // "the tool detects reuse" must not force the caller to predict whether
  // supplying sourceDescription is legal.
  const sd = reuseSkipsSourceDescription ? undefined : input.sourceDescription;
  if (sd !== undefined) {
    if (!sd || typeof sd !== "object" || Array.isArray(sd)) {
      throw new ResearchAppendError("`sourceDescription` must be an object: { title, author?, url? }");
    }
    const extras = Object.keys(sd).filter((k) => !["title", "author", "url"].includes(k));
    if (extras.length > 0) {
      throw new ResearchAppendError(
        `sourceDescription accepts only title, author, url (unexpected: ${extras.join(", ")})`,
      );
    }
    if (typeof sd.title !== "string" || sd.title.trim() === "") {
      throw new ResearchAppendError("sourceDescription.title is required (non-empty string)");
    }
    if (sourcesAppendIdx.length !== 1) {
      throw new ResearchAppendError(
        `sourceDescription requires exactly one sources append op in the call (found ${sourcesAppendIdx.length})`,
      );
    }
    const srcOp = ops[sourcesAppendIdx[0]];
    if (srcOp.entry && typeof srcOp.entry === "object") {
      if ((srcOp.entry as any).gedcomx_source_description_id != null) {
        throw new ResearchAppendError(
          fmt(
            sourcesAppendIdx[0],
            "carries a gedcomx_source_description_id AND the call supplies sourceDescription — " +
              "use one: reference the existing S id (drop sourceDescription), or let sourceDescription create it",
          ),
        );
      }
      const sId = nextId(tree, "S");
      const sEntry: any = { id: sId, title: sd.title };
      if (sd.author !== undefined && sd.author !== null) sEntry.author = sd.author;
      if (sd.url !== undefined && sd.url !== null) sEntry.url = sd.url;
      tree.sources = [...(tree.sources ?? []), sEntry];
      (srcOp.entry as any).gedcomx_source_description_id = sId;
      treeMutated = true;
      sourceDescriptionId = sId;
    }
  }

  // §3.4.1 "created" echo: detection engaged but found no reusable source —
  // the S the composite just created is the answer.
  if (detectionEngaged && !sourceReuse && sourceDescriptionId !== undefined) {
    sourceReuse = {
      action: "created",
      srcId: nextResearchId(Array.isArray(research.sources) ? research.sources : [], "src_"),
      sId: sourceDescriptionId,
    };
  }

  // ── 2. Every sources append op must reference an existing S entry ──
  const treeSourceIds = new Set((tree.sources ?? []).map((s: any) => s?.id).filter(Boolean));
  for (const i of sourcesAppendIdx) {
    const entry = ops[i].entry;
    if (!entry || typeof entry !== "object") continue; // applyOne reports the missing entry
    const ref = (entry as any).gedcomx_source_description_id;
    if (ref == null) {
      errors.push(
        fmt(
          i,
          "a sources append requires either the top-level `sourceDescription` (the tool creates the " +
            "tree S entry and stamps this field) or a `gedcomx_source_description_id` referencing an existing S entry",
        ),
      );
    } else if (!treeSourceIds.has(ref)) {
      const known = [...treeSourceIds].slice(0, 8).join(", ") || "none";
      errors.push(
        fmt(
          i,
          `gedcomx_source_description_id '${ref}' not found in tree.gedcomx.json — pass \`sourceDescription\` ` +
            `to create the S entry, or reference an existing S id (existing: ${known})`,
        ),
      );
    }
  }

  // ── 3. Auto-stamp source_id (single-sources-append batches only) ──
  if (sourcesAppendIdx.length === 1) {
    const pool = Array.isArray(research.sources) ? research.sources : [];
    const autoSourceId = nextResearchId(pool, "src_");
    for (const op of ops) {
      if (op.section !== "assertions" || op.op !== "append") continue;
      const entry = op.entry as any;
      if (!entry || typeof entry !== "object") continue;
      if (entry.source_id === undefined || entry.source_id === null) {
        entry.source_id = autoSourceId; // explicit source_id always wins
      }
    }
  }

  // ── 4 + 5. D2 matrix + place levers, per assertions append op ──
  // D2 auto-fill scoping: the sidecar's primaryId is the SEARCHED persona, not
  // necessarily the persona an arbitrary assertion describes — sidecar personas
  // carry no role labels, so an assertion's record_role cannot be checked
  // against them. The sound proxy is batch shape: stamping primaryId onto every
  // omitted persona is safe only when the batch's assertion appends all cite
  // ONE canonical record_id and ONE distinct record_role (a single-focus
  // extraction). Unscoped auto-fill stamped the focus persona's id onto other
  // household members' assertions (observed silent corruption).
  const batchAssertionRecordKeys = new Set(
    assertionAppends
      .map((op) => (op.entry as any).record_id)
      .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== "")
      .map((v: string) => arkToBareId(v)),
  );
  const batchAssertionRoles = new Set(
    assertionAppends
      .map((op) => (op.entry as any).record_role)
      .filter((v: unknown): v is string => typeof v === "string" && v.trim() !== ""),
  );
  const autoFillScopeOk = batchAssertionRecordKeys.size === 1 && batchAssertionRoles.size === 1;
  const logById = new Map<string, any>();
  for (const e of Array.isArray(research.log) ? research.log : []) {
    if (e && typeof e === "object" && typeof e.id === "string") logById.set(e.id, e);
  }
  const sidecarCache = new Map<string, any[] | null>();
  const readSidecarResults = async (ref: string): Promise<any[] | null> => {
    if (sidecarCache.has(ref)) return sidecarCache.get(ref)!;
    let results: any[] | null = null;
    if (isInsideProject(projectPath, ref)) {
      try {
        const sc = JSON.parse(await readFile(join(projectPath, ref), "utf-8"));
        if (sc && typeof sc === "object" && Array.isArray(sc.payload?.results)) {
          results = sc.payload.results;
        }
      } catch {
        // unreadable sidecar — the document validator reports it; skip enforcement
      }
    }
    sidecarCache.set(ref, results);
    return results;
  };

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.section !== "assertions" || op.op !== "append") continue;
    const entry = op.entry as any;
    if (!entry || typeof entry !== "object") continue;

    // ── D2: persona/record-id matrix against the log entry's sidecar ──
    let matchedRecord: any = null;
    const logId = entry.log_entry_id;
    const logEntry = typeof logId === "string" ? logById.get(logId) : undefined;
    if (logEntry) {
      const ref = logEntry.results_ref;
      if (!ref) {
        // No sidecar (record_read, PDF, image, pasted records): the field must
        // be absent or null — there is no persona document to point at.
        if (entry.record_persona_id != null) {
          errors.push(
            fmt(
              i,
              `record_persona_id must be null — log entry '${logId}' has no results sidecar ` +
                "(results_ref is null; record_read/PDF/image/pasted records carry no persona ids)",
            ),
          );
          continue;
        }
      } else if (typeof ref === "string") {
        const results = await readSidecarResults(ref);
        if (results) {
          const key = arkToBareId(String(entry.record_id ?? ""));
          const matches = results.filter(
            (r) => r && typeof r === "object" && typeof r.recordId === "string" && arkToBareId(r.recordId) === key,
          );
          if (matches.length === 0) {
            // A record_id outside the sidecar is legal when no persona is
            // claimed (e.g. a negative assertion naming the collection
            // searched); with a persona it is a contradiction.
            if (entry.record_persona_id != null) {
              const known = results
                .map((r) => (r && typeof r.recordId === "string" ? r.recordId : null))
                .filter(Boolean)
                .slice(0, 5)
                .join(", ");
              errors.push(
                fmt(
                  i,
                  `record_id '${entry.record_id}' does not match any result in sidecar '${ref}' — ` +
                    `expected one of: ${known}`,
                ),
              );
              continue;
            }
          } else {
            matchedRecord = matches[0];
            // Canonicalize record_id to the sidecar's stored form.
            if (entry.record_id !== matchedRecord.recordId) {
              entry.record_id = matchedRecord.recordId;
            }
            const personaIds: string[] = (
              Array.isArray(matchedRecord.gedcomx?.persons) ? matchedRecord.gedcomx.persons : []
            )
              .map((p: any) => (p && typeof p.id === "string" ? p.id : null))
              .filter(Boolean);
            if (entry.record_persona_id != null) {
              if (!personaIds.includes(entry.record_persona_id)) {
                const primary =
                  typeof matchedRecord.primaryId === "string"
                    ? ` (primary persona: ${matchedRecord.primaryId})`
                    : "";
                errors.push(
                  fmt(
                    i,
                    `record_persona_id '${entry.record_persona_id}' does not resolve to a person in ` +
                      `record '${matchedRecord.recordId}' — expected one of: ${personaIds.join(", ")}${primary}`,
                  ),
                );
                continue;
              }
            } else if (
              matches.length === 1 &&
              typeof matchedRecord.primaryId === "string" &&
              personaIds.includes(matchedRecord.primaryId)
            ) {
              if (personaIds.length === 1 || autoFillScopeOk) {
                // Auto-fill the unambiguous case — never silently null. Safe
                // because the record holds a single persona, or the batch is a
                // single-record single-role extraction (see scoping note above).
                entry.record_persona_id = matchedRecord.primaryId;
              } else {
                errors.push(
                  fmt(
                    i,
                    `record_persona_id omitted — multiple personas in this record (${personaIds.join(", ")}) ` +
                      "and the batch spans multiple record_roles/record_ids, so the omission is ambiguous; " +
                      `supply record_persona_id per assertion (the searched persona is '${matchedRecord.primaryId}')`,
                  ),
                );
                continue;
              }
            }
          }
        }
      }
    }

    // ── Place lever (b): never geocode what the source record already
    // resolved — copy the sidecar's standard_place for the same place string.
    // `standard_place: null` is an explicit opt-out (skip resolution + guard);
    // only a fully omitted field triggers resolution.
    let geocoded = false;
    if (typeof entry.place === "string" && entry.place.trim() !== "" && entry.standard_place === undefined) {
      let sp: string | null = null;
      let source: "sidecar" | "geocoded" | null = null;
      if (matchedRecord) {
        sp = sidecarStandardPlace(matchedRecord.gedcomx, entry.place);
        if (sp) source = "sidecar";
      }
      if (!sp && input.resolveStandardPlace !== false) {
        // resolveStandardPlace swallows network failures and returns null, so
        // a miss and a failure look the same here — both warrant the warning
        // (a silently unresolved place is part of the wrong-geocode theme).
        try {
          sp = (await resolveStandardPlace(entry.place)) ?? null;
        } catch {
          sp = null;
        }
        if (sp) {
          source = "geocoded";
          geocoded = true;
        } else {
          warnings.push(`could not resolve standard_place for '${entry.place}' (left unset)`);
        }
      }
      if (sp && source) {
        entry.standard_place = sp;
        resolvedPlaces.push({ place: entry.place, standardPlace: sp, source });
      }
    }

    // ── Place lever (a): country-contradiction guard on the final pair
    // (supplied or resolved). Skipped when standard_place is null/absent.
    if (typeof entry.place === "string" && typeof entry.standard_place === "string") {
      const verdict = countryConsistency(entry.place, entry.standard_place);
      if (verdict === "contradiction") {
        errors.push(
          fmt(
            i,
            `standard_place '${entry.standard_place}' contradicts place '${entry.place}' — the place text ` +
              "names a different country. Re-resolve with place_search / place_search_all and supply the " +
              "correct standard_place, or set standard_place: null if no standard form exists.",
          ),
        );
        continue;
      }
      if (verdict === "unverifiable" && geocoded) {
        warnings.push(
          `resolved standard_place '${entry.standard_place}' for place '${entry.place}' — the place text ` +
            "names no country, so the resolution could not be cross-checked; verify it is the right place",
        );
      }
    }
  }

  if (errors.length > 0) throw new ResearchAppendError(errors);
  return { treeMutated, sourceDescriptionId, sourceReuse, resolvedPlaces, warnings };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

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
  input.sourceDescription = coerceJsonArg(input.sourceDescription) as SourceDescriptionInput | undefined;

  const isBatch = input.ops !== undefined;
  const opsReceived = isBatch && Array.isArray(input.ops) ? input.ops.length : undefined;
  const fail = (errors: string[]): ResearchAppendResult =>
    opsReceived !== undefined ? { ok: false, errors, opsReceived } : { ok: false, errors };

  try {
    const research = await readJson(projectPath, "research.json");
    // Heal legacy tree shapes in memory; the healed document is what a
    // composite write persists (same one-shot migration as tree_edit). A
    // research-only call still never writes the tree.
    const sanitized = sanitizeTree(await readJson(projectPath, "tree.gedcomx.json"));
    const tree = sanitized.tree;

    let ops: ResearchAppendOp[];
    if (isBatch) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return fail(["`ops` must be a non-empty array"]);
      }
      ops = input.ops;
    } else {
      if (!input.section || !input.op) {
        return fail(["provide either `ops` (batch) or `section` + `op` (single)"]);
      }
      ops = [
        {
          section: input.section,
          op: input.op,
          entry: input.entry,
          entryId: input.entryId,
          fields: input.fields,
          planId: input.planId,
        },
      ];
    }

    const fmt = (i: number, msg: string) => (isBatch ? `ops[${i}]: ${msg}` : msg);

    // ─── Composite + enforcement pre-pass (stamps ids, mutates the tree) ─────
    const prep = await prepareOps(input, ops, research, tree, projectPath, fmt);

    // ─── Apply every op in-memory ─────────────────────────────────────────────
    const applied: AppliedOp[] = [];
    const appendedThisBatch = new Set<string>();
    for (let i = 0; i < ops.length; i++) {
      try {
        applied.push(applyOne(research, ops[i], appendedThisBatch));
      } catch (e) {
        if (e instanceof ResearchAppendError) {
          // Identify the failing op; nothing has been written.
          return fail(e.errors.map((m) => fmt(i, m)));
        }
        throw e;
      }
    }

    const opWarnings = [...prep.warnings, ...applied.flatMap((a) => a.warnings ?? [])];
    const anyMutation = applied.some((a) => !a.noop) || prep.treeMutated;

    // ─── Validate once, write once (both files when the tree changed) ────────
    let validationWarnings: string[] = [];
    let filesWritten: string[] = [];
    if (anyMutation) {
      const validation = await validateParsed(research, tree, { projectPath });
      if (!validation.valid) {
        return fail(mapValidationErrors(formatIssues(validation.errors), applied, isBatch));
      }
      validationWarnings = formatIssues(validation.warnings);
      const researchPath = join(projectPath, "research.json");
      if (prep.treeMutated) {
        const treePath = join(projectPath, "tree.gedcomx.json");
        await backupIfExists(treePath); // one-deep .bak, same semantics as every tree writer
        await atomicWriteBoth([
          { path: treePath, data: tree }, // tree first —
          { path: researchPath, data: research }, // — then research (commit order)
        ]);
        filesWritten = ["tree.gedcomx.json", "research.json"];
        validationWarnings = [...sanitized.warnings, ...validationWarnings];
      } else {
        await atomicWriteJson(researchPath, research);
        filesWritten = ["research.json"];
      }
    }

    const validationBlock = { valid: true as const, warnings: [...validationWarnings, ...opWarnings] };
    const extras: Pick<BatchSuccess, "sourceDescriptionId" | "sourceReuse" | "resolvedPlaces"> = {};
    if (prep.sourceDescriptionId) extras.sourceDescriptionId = prep.sourceDescriptionId;
    if (prep.sourceReuse) extras.sourceReuse = prep.sourceReuse;
    if (prep.resolvedPlaces.length > 0) extras.resolvedPlaces = prep.resolvedPlaces;

    if (isBatch) {
      return {
        ok: true,
        results: applied.map((a) => ({ section: a.section, op: a.op, entryId: a.entryId })),
        ...extras,
        filesWritten,
        validation: validationBlock,
      };
    }
    return {
      ok: true,
      section: applied[0].section,
      op: applied[0].op,
      entryId: applied[0].entryId,
      ...extras,
      filesWritten,
      validation: validationBlock,
    };
  } catch (e) {
    if (e instanceof ResearchAppendError) return fail(e.errors);
    throw e;
  }
}

/** Best-effort mapping of whole-document validation errors back to the batch op
 *  that touched the offending entry, so failure responses name the failing ops.
 *  Errors on entries no op touched keep their `research.json/…` path. */
function mapValidationErrors(errors: string[], applied: AppliedOp[], isBatch: boolean): string[] {
  if (!isBatch) return errors;
  const byLocation = new Map<string, number>();
  for (let k = 0; k < applied.length; k++) {
    const a = applied[k];
    if (a.arrayIndex !== undefined) byLocation.set(`${a.section}[${a.arrayIndex}]`, k);
  }
  return errors.map((msg) => {
    const m = msg.match(/^research\.json\/([a-z_]+)\[(\d+)\]/);
    if (m) {
      const k = byLocation.get(`${m[1]}[${m[2]}]`);
      if (k !== undefined) return `ops[${k}]: ${msg}`;
    }
    return msg;
  });
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const researchAppendSchema = {
  name: "research_append",
  description:
    "Write structured entries to the mutable research.json sections — append a new " +
    "entry (the tool assigns the id) or update an existing one in place (preserving " +
    "its id; there is no delete — supersede via a status/`superseded_by` field). Use " +
    "this for the analytical sections; use research_log_append for the research log, " +
    "and the merge / tree_edit tools for other tree.gedcomx.json edits.\n" +
    "\n" +
    "Supply each entry in its persisted snake_case shape WITHOUT an id; the tool " +
    "assigns the next `<prefix>NNN`, stamps tool-owned timestamps, validates the " +
    "whole project, and writes atomically. Returns a compact summary; on any failure " +
    "nothing is written.\n" +
    "\n" +
    "To persist a whole record in ONE call, pass an `ops` array (each op is " +
    "`{ section, op, entry?/entryId?/fields?, planId? }`): one sources append plus one " +
    "assertions append per fact, with the top-level `sourceDescription: { title, " +
    "author?, url? }`. The tool then creates the tree.gedcomx.json source description " +
    "(assigning the S id), stamps the source op's `gedcomx_source_description_id` and " +
    "every assertion's `source_id`, auto-fills/verifies `record_persona_id` and " +
    "canonicalizes `record_id` against the log entry's results sidecar, resolves " +
    "`standard_place` for assertion places (copying the sidecar's resolution when " +
    "present; resolved values are echoed in `resolvedPlaces`), validates ONCE, and " +
    "writes tree.gedcomx.json + research.json together. Source reuse is " +
    "auto-detected: when the batch's assertions cite a record_id an existing source " +
    "already covers, the tool updates that source in place (same repository) or " +
    "reuses its S entry (different repository) instead of duplicating — always " +
    "supply `sourceDescription` and relay the echoed `sourceReuse` " +
    "({ action: created | updated_existing | new_source_reused_s, srcId, sId }). " +
    "To cite a specific known S entry explicitly, omit `sourceDescription` and set " +
    "the sources op's `gedcomx_source_description_id` to that S id. Batches are " +
    "all-or-nothing: on failure nothing is written and errors name the failing ops " +
    "(`ops[i]: <msg>`) plus `opsReceived` so you can confirm no op was dropped.",
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
      sourceDescription: {
        type: "object",
        description:
          "Composite persist: the tree.gedcomx.json source description to create for " +
          "this call's single sources append op. The tool assigns the S id, writes the " +
          "S entry, and stamps the source op's gedcomx_source_description_id — never " +
          "predict or pre-create the S yourself. Omit when the sources op references " +
          "an S entry that already exists.",
        properties: {
          title: { type: "string", description: "Required. The source description title." },
          author: { type: "string", description: "Optional author. Omit when not applicable (never null)." },
          url: { type: "string", description: "Optional URL. Omit when not applicable (never null)." },
        },
        required: ["title"],
      },
      resolveStandardPlace: {
        type: "boolean",
        description:
          "Default true: for an assertion append with a `place` but no `standard_place`, " +
          "the tool copies the sidecar record's resolved standard_place when available, " +
          "else geocodes the place text. Pass false to skip the geocoding lookup " +
          "(sidecar copy still applies). Supply `standard_place: null` on an entry to " +
          "opt a single assertion out entirely.",
      },
    },
    required: ["projectPath"],
  },
};
