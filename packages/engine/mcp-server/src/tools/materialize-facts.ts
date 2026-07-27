// materialize_facts — write a record persona's extracted assertions onto a tree
// person as SOURCED facts/names (spec docs/specs/tree-materialization-spec.md §4).
//
// The record→tree workhorse. The caller passes REFERENCES only
// ({ projectPath, personId, recordId, recordRole }); the tool reads the persona's
// assertions (every assertion matching recordId + recordRole) from research.json,
// resolves each one's provenance chain
// (assertion.source_id → research source.gedcomx_source_description_id → tree
// S-entry id) into a non-null source-ref, and writes to tree.gedcomx.json only.
// Because the input is references, the intact provenance chain is read from disk
// and CANNOT be dropped — the structural cure for the cruz "0/13 facts carried a
// ref" leak.
//
// Fact identity reuses the existing `factsEquivalent` (type + date/place-compat)
// from utils/merge-gedcomx.ts plus an equal-`value` check — never a
// `(fact_type, value)` key (`value` is null for event facts, which would collapse
// every Birth into one fact). Agreeing values union their refs onto one fact;
// incompatible date/place OR a different value coexist as separate facts. A
// competing value of a single-valued/vital type (VITAL_PRIMARY_TYPES) is surfaced
// in conflicts_surfaced; multi-valued types (Occupation, Residence, Census, …)
// coexist silently. materialize_facts NEVER sets `primary`/`preferred` — only
// proof-conclusion does — and never writes relationships or `conflicts` entries.
//
// The write tail (sanitizeTree → read research → apply → validateParsed →
// backupIfExists → atomicWriteJson) mirrors tree_edit's executeTreeOps; it is a
// SINGLE-FILE tree write (atomicWriteJson, never atomicWriteBoth).

import { join } from "path";
import { readFile } from "fs/promises";
import type {
  SimplifiedGedcomX,
  SimplifiedPerson,
  SimplifiedName,
  SimplifiedFact,
  SimplifiedSourceReference,
} from "../types/gedcomx.js";
import type {
  MaterializeFactsInput,
  MaterializeFactsOp,
  MaterializeFactsOpResult,
  MaterializeFactsResult,
  ConflictSurfaced,
} from "../types/materialize-facts.js";
import { validateParsed } from "../validation/validator.js";
import { sanitizeTree } from "../validation/tree-sanitize.js";
import type { ValidationError } from "../validation/types.js";
import { atomicWriteJson, backupIfExists } from "../utils/project-io.js";
import { nextId } from "../utils/gedcomx-ids.js";
import { factsEquivalent, VITAL_PRIMARY_TYPES } from "../utils/merge-gedcomx.js";
import { coerceJsonArg } from "../utils/coerce-json-arg.js";
import { resolveSourceRef as resolveSourceRefShared } from "../utils/source-ref-resolver.js";

class MaterializeFactsError extends Error {}

// ─── fact_type → tree fact type (honors the #711 structured-fact model) ───────
//
// An event's place/date are ATTRIBUTES of the one event fact, not their own fact
// types — extraction already folds birthplace/birth-date into a single `birth`
// assertion (research-append canonicalization), so here we only PascalCase the
// canonical event type and let date/place/value ride along as attributes. The
// value is null for event facts (below), which is why fact identity keys on
// `factsEquivalent` + `value`, never `(type, value)`.

/** Assertion fact_types handled as NON-facts: names, gender, and the ones this
 *  tool deliberately does not materialize (relationship edges are `tree_edit`
 *  add_relationship's job, §4.5; `age` is indirect evidence feeding a birth-year
 *  inference, not a standalone tree fact; `marriage` is a Couple-relationship
 *  event — per tree-edit.ts's own convention, "a Marriage/Divorce fact lives
 *  on the Couple, never duplicated onto each spouse" — so it can never be a
 *  correct PERSON-level write, structurally, not just usually. A caller
 *  wanting the marriage's date/place on the tree writes it via `tree_edit`
 *  `add_relationship`'s Couple `facts`, sourced with the same assertion via
 *  `sourceAssertionId`). Guards the exact mistake ut_person_evidence_022
 *  regression-tests: a `marriage` assertion on an already-existing spouse's
 *  persona getting materialized straight onto that person, leaving the
 *  relationship itself factless. */
const NAME_TYPES: ReadonlySet<string> = new Set(["name"]);
const GENDER_TYPES: ReadonlySet<string> = new Set(["gender", "sex"]);
const SKIP_TYPES: ReadonlySet<string> = new Set(["relationship", "age", "marriage"]);

/** Tree fact types whose `value` is null (events + place/duration attributes) —
 *  the qualifier `value` field is meaningful only for value-bearing types
 *  (Occupation, Race, Religion, Nationality, …). */
const EVENT_TREE_TYPES: ReadonlySet<string> = new Set([
  "Birth", "Death", "Christening", "Burial", "Baptism", "Cremation",
  "Marriage", "Divorce", "Annulment", "Engagement", "MarriageBanns",
  "Residence", "Census", "MunicipalCensus", "Immigration", "Emigration",
  "Naturalization", "Will", "Probate", "Adoption",
]);

/** PascalCase a canonical snake_case fact_type into its tree type spelling:
 *  `birth` → `Birth`, `cause_of_death` → `CauseOfDeath`. Guarantees the
 *  uppercase-initial the tree schema requires. */
function toTreeFactType(factType: string): string {
  return factType
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// ─── small helpers ────────────────────────────────────────────────────────────

function formatIssues(issues: ValidationError[]): string[] {
  return issues.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

async function readJson(projectPath: string, filename: string): Promise<any> {
  let text: string;
  try {
    text = await readFile(join(projectPath, filename), "utf-8");
  } catch {
    throw new MaterializeFactsError(`${filename} not found in projectPath`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new MaterializeFactsError(`${filename} is not valid JSON`);
  }
}

/** Trimmed non-empty string, else undefined. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Normalize a comparison key for a name part (case/space-insensitive). */
function normNamePart(v: string | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** Normalize a record/persona gender value to the tree enum, else undefined. */
function normGender(v: unknown): "Male" | "Female" | "Unknown" | undefined {
  const g = String(v ?? "").trim().toLowerCase();
  if (g === "male" || g === "m") return "Male";
  if (g === "female" || g === "f") return "Female";
  if (g === "unknown" || g === "u") return "Unknown";
  return undefined;
}

/** A readable descriptor of a coexisting competing fact (value, or date/place). */
function factDescriptor(fact: SimplifiedFact): string {
  const v = str(fact.value);
  if (v) return v;
  const parts = [str(fact.date), str(fact.standard_place) ?? str(fact.place)].filter(Boolean);
  return parts.length ? parts.join(", ") : (fact.id ?? "(fact)");
}

// ─── provenance resolution (§4.2 step 2 — error, never null) ──────────────────

/**
 * Resolve an assertion's source-ref (the provenance-chain walk itself lives in
 * `utils/source-ref-resolver.ts`, shared with `tree_edit`'s add_relationship
 * `sourceAssertionId` — tree-materialization-spec §8), wrapped so a missing
 * hop surfaces as this tool's own error class. A missing tree S-entry is an
 * upstream research_append gate failure to surface, not to paper over with null.
 */
function resolveSourceRef(
  assertion: any,
  research: any,
  tree: SimplifiedGedcomX,
): SimplifiedSourceReference {
  try {
    return resolveSourceRefShared(assertion, research, tree);
  } catch (e) {
    throw new MaterializeFactsError((e as Error).message);
  }
}

/** Union `ref` into `node.sources` (dedup on ref + page). Returns true when a
 *  new ref was actually attached. */
function unionRef(
  node: { sources?: SimplifiedSourceReference[] },
  ref: SimplifiedSourceReference,
): boolean {
  node.sources ??= [];
  const key = `${ref.ref ?? ""}|${ref.page ?? ""}`;
  for (const r of node.sources) {
    if (`${r.ref ?? ""}|${r.page ?? ""}` === key) return false;
  }
  node.sources.push({ ...ref });
  return true;
}

// ─── build the tree-fact / tree-name candidate from an assertion ──────────────

interface FactCandidate {
  type: string;
  date?: string;
  place?: string;
  standard_place?: string;
  value?: string;
}

function factCandidate(assertion: any): FactCandidate {
  const type = toTreeFactType(String(assertion.fact_type));
  const cand: FactCandidate = { type };
  const date = str(assertion.date);
  if (date) cand.date = date;
  const place = str(assertion.place);
  if (place) cand.place = place;
  const standardPlace = str(assertion.standard_place);
  if (standardPlace) cand.standard_place = standardPlace;
  // Event facts carry no `value` (place/date are attributes, #711); value-bearing
  // types (Occupation, …) keep the assertion's value.
  if (!EVENT_TREE_TYPES.has(type)) {
    const value = str(assertion.value);
    if (value) cand.value = value;
  }
  return cand;
}

/** A SimplifiedFact view of a candidate for factsEquivalent(). */
function candAsFact(cand: FactCandidate): SimplifiedFact {
  const f: SimplifiedFact = { type: cand.type };
  if (cand.date !== undefined) f.date = cand.date;
  if (cand.place !== undefined) f.place = cand.place;
  if (cand.standard_place !== undefined) f.standard_place = cand.standard_place;
  if (cand.value !== undefined) f.value = cand.value;
  return f;
}

/** Given/surname from a name assertion — its structured_value when present, else
 *  parsed from `value` (surname = last token). Both parts are always returned
 *  (empty string, not undefined) so the minted name satisfies the tree schema's
 *  present-and-string given/surname requirement. */
function nameParts(assertion: any): { given: string; surname: string } {
  const sv = assertion.structured_value;
  if (sv && typeof sv === "object" && !Array.isArray(sv)) {
    const given = typeof sv.given === "string" ? sv.given : "";
    const surname = typeof sv.surname === "string" ? sv.surname : "";
    if (given || surname) return { given, surname };
  }
  const tokens = String(assertion.value ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { given: "", surname: "" };
  if (tokens.length === 1) return { given: tokens[0], surname: "" };
  return { given: tokens.slice(0, -1).join(" "), surname: tokens[tokens.length - 1] };
}

// ─── apply one persona-materialization op to a shared in-memory tree ─────────
//
// Pure mutation, shared by both call shapes below: given the tree and
// research documents (already read from disk) plus one persona reference,
// mints/enriches the target person and returns its per-op result payload.
// Throws MaterializeFactsError on failure — the caller (single-op or batch)
// decides how to report it (bare message, or `ops[i]: <message>`). Keeping
// this in one place means create-or-enrich, fact-identity, and
// conflict-surfacing behavior (§4.2-§4.4) is defined exactly once regardless
// of how many personas one call materializes.
function applyMaterializeOp(
  tree: SimplifiedGedcomX,
  research: any,
  op: MaterializeFactsOp,
): MaterializeFactsOpResult {
  const { recordId, recordRole } = op;
  if (str(recordId) === undefined || str(recordRole) === undefined) {
    throw new MaterializeFactsError("recordId and recordRole are required");
  }

  // The persona: every assertion matching recordId + recordRole.
  const assertions = (Array.isArray(research.assertions) ? research.assertions : []).filter(
    (a: any) => a && a.record_id === recordId && a.record_role === recordRole,
  );
  if (assertions.length === 0) {
    throw new MaterializeFactsError(
      `no assertions found for recordId '${recordId}' and recordRole '${recordRole}'`,
    );
  }

  // ── Create-or-enrich: find the target person, or mint it (§4.3) ──
  const targetId = str(op.personId) ?? nextId(tree, "I");
  let person = (tree.persons ?? []).find((p) => p && p.id === targetId);
  let created = false;
  if (!person) {
    created = true;
    // Gender from the persona's gender/sex assertions, else Unknown.
    let gender: "Male" | "Female" | "Unknown" = "Unknown";
    for (const a of assertions) {
      if (GENDER_TYPES.has(String(a.fact_type))) {
        const g = normGender(a.value);
        if (g) {
          gender = g;
          break;
        }
      }
    }
    person = { id: targetId, gender, names: [] };
    tree.persons = [...(tree.persons ?? []), person];
  }

  // Snapshot pre-existing node ids so enrich (vs. add) counts are honest and a
  // re-run is a no-op. Scoped to THIS op — in a batch, an earlier op's writes
  // to this same person are already on `person.facts` and correctly count as
  // pre-existing for this op, exactly as if they'd arrived in an earlier,
  // separate call.
  const preFactIds = new Set((person.facts ?? []).map((f) => f.id));
  const createdFactIds = new Set<string>();
  const enrichedFactIds = new Set<string>();
  const createdNameIds = new Set<string>();
  let namesAdded = 0;
  let refsAttached = 0;

  for (const a of assertions) {
    const rawType = String(a.fact_type ?? "").toLowerCase();

    // Purely-argumentative / negative evidence is not a positive tree fact
    // (spec §7.1 (4)) — it stays a research.json assertion feeding the argument;
    // only its conclusion materializes, via proof-conclusion.
    if (a.evidence_type === "negative") continue;

    if (GENDER_TYPES.has(rawType)) {
      // Gender sets the scalar, not a fact/name (no ref); never overwrite a
      // resolved Male/Female with a conflicting one — only fill Unknown/absent.
      const g = normGender(a.value);
      if (g && (person.gender === undefined || person.gender === "Unknown")) {
        person.gender = g;
      }
      continue;
    }

    if (NAME_TYPES.has(rawType)) {
      const ref = resolveSourceRef(a, research, tree);
      const { given, surname } = nameParts(a);
      person.names ??= [];
      const match = person.names.find(
        (n) => normNamePart(n.given) === normNamePart(given) && normNamePart(n.surname) === normNamePart(surname),
      );
      if (match) {
        if (unionRef(match, ref)) refsAttached++;
      } else {
        const name: SimplifiedName = {
          id: nextId(tree, "N"),
          type: "BirthName",
          given,
          surname,
          sources: [ref],
        };
        person.names.push(name);
        createdNameIds.add(name.id!);
        namesAdded++;
        refsAttached++;
      }
      continue;
    }

    if (SKIP_TYPES.has(rawType)) continue;

    // A value-bearing / event fact. Resolve provenance first (§4.2 step 2:
    // error, never null), then upsert by fact identity.
    const ref = resolveSourceRef(a, research, tree);
    const cand = factCandidate(a);
    const candFact = candAsFact(cand);
    person.facts ??= [];
    const match = person.facts.find(
      (f) => factsEquivalent(f, candFact) && str(f.value) === cand.value,
    );

    if (match) {
      // Same fact — corroboration. Fill any attribute the existing fact lacks
      // (never remove, never upgrade a set field) and union the ref. NEVER set
      // `primary`.
      let fieldChanged = false;
      if (str(match.date) === undefined && cand.date !== undefined) {
        match.date = cand.date;
        fieldChanged = true;
      }
      if (str(match.place) === undefined && cand.place !== undefined) {
        match.place = cand.place;
        fieldChanged = true;
      }
      if (str(match.standard_place) === undefined && cand.standard_place !== undefined) {
        match.standard_place = cand.standard_place;
        fieldChanged = true;
      }
      if (str(match.value) === undefined && cand.value !== undefined) {
        match.value = cand.value;
        fieldChanged = true;
      }
      const refAdded = unionRef(match, ref);
      if (refAdded) refsAttached++;
      // Only a fact that existed BEFORE this op counts as "enriched"; a
      // corroboration of a fact minted earlier in the same op is not.
      if (match.id !== undefined && preFactIds.has(match.id) && (fieldChanged || refAdded)) {
        enrichedFactIds.add(match.id);
      }
    } else {
      // Coexist — a competing or new fact. Mint it with its ref. NEVER set
      // `primary`.
      const fact: SimplifiedFact = { id: nextId(tree, "F"), type: cand.type };
      if (cand.date !== undefined) fact.date = cand.date;
      if (cand.place !== undefined) fact.place = cand.place;
      if (cand.standard_place !== undefined) fact.standard_place = cand.standard_place;
      if (cand.value !== undefined) fact.value = cand.value;
      fact.sources = [ref];
      person.facts.push(fact);
      createdFactIds.add(fact.id!);
      refsAttached++;
    }
  }

  // A newly-minted person MUST end up with a name (the tree schema requires it,
  // and a create-or-enrich person is never nameless in practice).
  if (created && (person.names ?? []).length === 0) {
    throw new MaterializeFactsError(
      `cannot mint person '${targetId}' — the persona has no name assertion to build a name from`,
    );
  }

  // ── Conflict surfacing — single-valued/vital types only (§4.4 / Cluster F) ──
  // A vital type now holding ≥2 coexisting facts, at least one authored this
  // op, is a surfaced conflict. Multi-valued types (Occupation, Residence,
  // Census, …) are never in VITAL_PRIMARY_TYPES, so they coexist silently.
  const conflicts_surfaced: ConflictSurfaced[] = [];
  for (const type of VITAL_PRIMARY_TYPES) {
    const ofType = (person.facts ?? []).filter((f) => f.type === type);
    if (ofType.length >= 2 && ofType.some((f) => f.id !== undefined && createdFactIds.has(f.id))) {
      conflicts_surfaced.push({
        personId: targetId,
        factType: type,
        values: ofType.map(factDescriptor),
      });
    }
  }

  return {
    personId: targetId,
    created,
    factsAdded: createdFactIds.size,
    factsEnriched: enrichedFactIds.size,
    namesAdded,
    refsAttached,
    conflicts_surfaced,
  };
}

// ─── the tool ─────────────────────────────────────────────────────────────────

export async function materializeFacts(
  input: MaterializeFactsInput,
): Promise<MaterializeFactsResult> {
  const { projectPath } = input;

  // Recover a batch `ops` array the model serialized as a JSON string (see
  // coerceJsonArg) before any shape checks — mirrors tree_edit/tree_correct,
  // and for the same reason: a large `ops` batch is exactly the size that
  // pushes a model toward stringifying it.
  input.ops = coerceJsonArg(input.ops) as MaterializeFactsOp[] | undefined;

  try {
    // Heal legacy tree shapes in memory, then read research.json (assertions
    // live there). Single-file write path — research.json is read, never written.
    const sanitized = sanitizeTree(await readJson(projectPath, "tree.gedcomx.json"));
    const tree = sanitized.tree;
    const research = await readJson(projectPath, "research.json");
    const treePath = join(projectPath, "tree.gedcomx.json");

    // ─── Batch form: apply every op in-memory, then validate + write once ────
    if (input.ops !== undefined) {
      if (!Array.isArray(input.ops) || input.ops.length === 0) {
        return { ok: false, errors: ["`ops` must be a non-empty array"] };
      }
      const results: MaterializeFactsOpResult[] = [];
      for (let i = 0; i < input.ops.length; i++) {
        try {
          results.push(applyMaterializeOp(tree, research, input.ops[i]));
        } catch (e) {
          if (e instanceof MaterializeFactsError) {
            // Identify the failing op; nothing has been written.
            return { ok: false, errors: [`ops[${i}]: ${e.message}`] };
          }
          throw e;
        }
      }

      const validation = await validateParsed(research, tree, { projectPath });
      if (!validation.valid) {
        return { ok: false, errors: formatIssues(validation.errors) };
      }
      await backupIfExists(treePath);
      await atomicWriteJson(treePath, tree);
      return {
        ok: true,
        results,
        filesWritten: ["tree.gedcomx.json"],
        validation: {
          valid: true,
          warnings: [...sanitized.warnings, ...formatIssues(validation.warnings)],
        },
      };
    }

    // ─── Single-op form (behavior unchanged) ─────────────────────────────────
    const result = applyMaterializeOp(tree, research, {
      personId: input.personId,
      recordId: input.recordId!,
      recordRole: input.recordRole!,
    });

    const validation = await validateParsed(research, tree, { projectPath });
    if (!validation.valid) {
      return { ok: false, errors: formatIssues(validation.errors) };
    }
    await backupIfExists(treePath);
    await atomicWriteJson(treePath, tree);

    return {
      ok: true,
      ...result,
      filesWritten: ["tree.gedcomx.json"],
      validation: {
        valid: true,
        warnings: [...sanitized.warnings, ...formatIssues(validation.warnings)],
      },
    };
  } catch (e) {
    if (e instanceof MaterializeFactsError) return { ok: false, errors: [e.message] };
    throw e;
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const materializeFactsSchema = {
  name: "materialize_facts",
  description:
    "Write a record persona's extracted assertions onto a tree person as SOURCED " +
    "facts and names. Pass REFERENCES only — { projectPath, personId, recordId, " +
    "recordRole } — and the tool reads the persona's assertions (every assertion " +
    "matching recordId + recordRole) from research.json, resolves each one's " +
    "provenance (assertion.source_id -> research source -> tree S-entry) into a " +
    "non-null source-ref, and writes only tree.gedcomx.json. You never hand-assemble " +
    "a document, so the provenance chain cannot be dropped.\n" +
    "\n" +
    "Create-or-enrich: if personId names a person that does not exist yet, the tool " +
    "mints it from the persona's name/gender assertions, so the person is never " +
    "fact-less. Idempotent: re-running the same persona duplicates neither facts nor " +
    "refs. Agreeing values (compatible date/place, equal value) union their refs onto " +
    "one fact; an incompatible date/place OR a different value coexists as a separate " +
    "sourced fact. A competing value of a single-valued/vital type (Birth, Death, " +
    "Christening, Burial) is reported in conflicts_surfaced for conflict-resolution; " +
    "multi-valued types (Occupation, Residence, Census, …) coexist silently.\n" +
    "\n" +
    "materialize_facts NEVER sets primary/preferred (only proof-conclusion does), " +
    "never resolves conflicts, never writes relationships (use tree_edit " +
    "add_relationship), never writes research.json, and silently skips `marriage` " +
    "assertions (a Couple-relationship event — never a correct person-level fact; " +
    "put it on the Couple via tree_edit add_relationship's facts, sourced with the " +
    "same assertion via sourceAssertionId). If a persona's source has no " +
    "tree S-entry, the call errors — materialize the record's source first (via " +
    "research_append's composite sourceDescription). Returns a compact summary " +
    "{ personId, created, factsAdded, factsEnriched, namesAdded, refsAttached, " +
    "conflicts_surfaced } — never an echo of the written tree.\n" +
    "\n" +
    "To materialize several personas at once (e.g. a whole household — the subject " +
    "plus siblings and a spouse from the same or different records), pass an `ops` " +
    "array instead of the top-level personId/recordId/recordRole: each op is " +
    "`{ personId?, recordId, recordRole }` (the same per-op fields). The tool applies " +
    "all ops to one in-memory tree, validates ONCE, and writes ONCE — all-or-nothing " +
    "(on any op's failure nothing is written and the error is `ops[i]: <msg>`). Ids " +
    "minted by an earlier op (e.g. a new person from create-or-enrich) are visible to " +
    "later ops. Returns `results: [{ personId, created, factsAdded, factsEnriched, " +
    "namesAdded, refsAttached, conflicts_surfaced }]`, one entry per op, in order.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the project directory holding tree.gedcomx.json and research.json.",
      },
      personId: {
        type: "string",
        description:
          "Target tree person id. May name a person that does not exist yet — the tool mints it " +
          "from the persona's name/gender assertions (create-or-enrich). Omit to mint a brand-new " +
          "person with the next allocated I id. Ignored when `ops` is present.",
      },
      recordId: {
        type: "string",
        description:
          "The record the persona belongs to (matches assertion.record_id). Ignored when `ops` " +
          "is present.",
      },
      recordRole: {
        type: "string",
        description:
          "The persona's role on that record (matches assertion.record_role). Ignored when `ops` " +
          "is present.",
      },
      ops: {
        type: "array",
        description:
          "Batch form: materialize many personas in one validate-once/write-once call " +
          "(all-or-nothing). When present, the top-level personId/recordId/recordRole are " +
          "ignored. Each op is the same `{ personId?, recordId, recordRole }` the single form takes.",
        items: {
          type: "object",
          properties: {
            personId: { type: "string" },
            recordId: { type: "string" },
            recordRole: { type: "string" },
          },
          required: ["recordId", "recordRole"],
        },
      },
    },
    required: ["projectPath"],
  },
};
