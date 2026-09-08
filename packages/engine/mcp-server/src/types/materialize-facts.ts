// materialize_facts — I/O types (spec docs/specs/tree-materialization-spec.md §4).
//
// Two op shapes, and the difference matters. The PERSONA op takes REFERENCES
// only (a persona = recordId + recordRole, plus the target personId) and reads
// the persona's assertions from research.json itself, so the LLM never
// hand-assembles a document and cannot drop the provenance chain. The
// NAMED-PARTY op (§4.6) serves a party who has no persona to reference — a
// bride named inside the groom's marriage assertion — so it necessarily takes
// one piece of caller-supplied data, her name, and nothing else: the tool
// resolves and enforces the source-ref the caller cannot drop. What is
// structural in both is the PROVENANCE, not the input shape.
//
// Parameter names are camelCase (the MCP wire boundary); the persisted tree
// stays snake_case.

/** One competing single-valued/vital fact type surfaced for conflict-resolution
 *  (materialize_facts reports; it never writes `conflicts` entries — §4.4). */
export interface ConflictSurfaced {
  personId: string;
  factType: string;
  /** Human-readable descriptors of the coexisting competing facts of this type
   *  (value, or date/place — `value` is null on event facts). */
  values: string[];
}

/** One persona reference — the body of a single call, or one element of a
 *  batch `ops`. */
export interface MaterializeFactsOp {
  /** Target tree person. May name a person that does not yet exist — the tool
   *  mints it from the persona's name/gender assertions (create-or-enrich).
   *  Omit to let the tool allocate the next `I` id for a brand-new person. */
  personId?: string;
  /** The record the persona belongs to (matches assertion.record_id). */
  recordId: string;
  /** The persona's role on that record (matches assertion.record_role). */
  recordRole: string;
}

/** The name of a party an assertion names but gives no persona of its own.
 *  Both parts are optional individually; at least one must be non-empty. */
export interface NamedPartyName {
  given?: string;
  surname?: string;
}

/** One NAMED-PARTY reference (§4.6) — mint or enrich the party a
 *  `relationship`/`marriage` assertion NAMES but does not give its own
 *  `record_role`: the bride in the groom's marriage register is the canonical
 *  case. She has no persona, so there is nothing for the persona op above to
 *  select on. A parent named in a child's baptism is the same shape in
 *  principle, but in this corpus extraction gives that parent its own persona,
 *  so the arm refuses it and points at the persona form — check before
 *  reaching for this one on a parentage assertion.
 *
 *  The caller supplies the name because the assertion usually does not carry
 *  one in machine-readable form (8 of 162 corpus `relationship`/`marriage`
 *  assertions put it in `structured_value`, under five distinct key shapes).
 *  The tool
 *  supplies the source-ref, resolved from the assertion's own `source_id`, and
 *  refuses the write without it — so the ref is ENFORCED rather than
 *  remembered, which is the leak this closes. The name is not and cannot be
 *  validated against the record. */
export interface MaterializeFactsNamedPartyOp {
  /** The `relationship`/`marriage` assertion that names this party
   *  (matches assertion.id). Selects this op shape. */
  assertionId: string;
  /** The role of the party being minted — the one that is NOT the persona
   *  ("bride", "mother"). Use the record's own spelling where it has one. It is
   *  checked against the assertion's own `record_role` AND against every
   *  `record_role` on that record: if a persona with this role exists and could
   *  be materialized instead, the call is refused and names the
   *  `{ recordId, recordRole }` to use, because that form writes her facts too.
   *  Otherwise unused — nothing on a tree person holds a role, and this tool
   *  never writes research.json. Required rather than optional because a guard
   *  a caller can skip by omitting it is not a guard, and best-effort because
   *  both roles are free text (spec section 4.6). */
  relatedRole: string;
  /** The name the record gives this party. At least one part non-empty. */
  name: NamedPartyName;
  /** Optional gender for the minted person; fills only an absent/Unknown one. */
  gender?: string;
  /** Optional name type ("BirthName", "MarriedName", …). OMITTED when absent:
   *  a party named inside another persona's assertion is often named by a
   *  surname that is not her birth surname, so the tool asserts no type it
   *  cannot support from the record. */
  nameType?: string;
  /** Target tree person. Omit to mint a brand-new person with the next `I` id. */
  personId?: string;
}

/** One element of a batch `ops` — either shape. Discriminated by the presence
 *  of `assertionId`; the narrowing guard lives with its caller in
 *  `tools/materialize-facts.ts`, since `src/types/` carries no runtime code. */
export type MaterializeFactsAnyOp = MaterializeFactsOp | MaterializeFactsNamedPartyOp;

// A `type` intersection, NOT `interface extends Partial<A | B>`: `Partial`
// distributes over a union and an interface cannot extend one (TS2312).
export type MaterializeFactsInput = Partial<MaterializeFactsOp> &
  Partial<MaterializeFactsNamedPartyOp> & {
    /** Absolute path to the project directory (tree.gedcomx.json + research.json). */
    projectPath: string;
    // Batch form — supply ops; when present the single-op fields above are
    // ignored. Every op applies to one in-memory tree; the tool validates once
    // and writes once (all-or-nothing). Ids assigned earlier in the batch are
    // visible to later ops (the allocator rescans the live tree).
    ops?: MaterializeFactsAnyOp[];
  };

/** The per-persona result payload — the body of a single call's success, or
 *  one element of a batch `results`. */
export interface MaterializeFactsOpResult {
  personId: string;
  /** true when the person was minted this call (create-or-enrich). */
  created: boolean;
  /** Facts newly authored on the person this call. */
  factsAdded: number;
  /** Pre-existing facts that gained a source-ref or a merged field this call. */
  factsEnriched: number;
  /** Names newly authored on the person this call. */
  namesAdded: number;
  /** Source-refs newly attached to any fact/name this call. */
  refsAttached: number;
  /** Competing single-valued/vital facts that now coexist (§4.4). */
  conflicts_surfaced: ConflictSurfaced[];
}

/** Compact summary — never an echo of the written tree JSON (§4.1). */
export type MaterializeFactsResult =
  | ({
      ok: true;
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    } & MaterializeFactsOpResult)
  | {
      ok: true;
      /** One entry per `ops[]` element, in order — the batch form. */
      results: MaterializeFactsOpResult[];
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  // `reason: "no_project"` marks the one ok:false that is an answer rather than
  // a failure (see noProjectResult). Optional field on the existing arm, NOT a
  // third arm — every `if (!r.ok) r.errors…` keeps narrowing as it does today.
  | { ok: false; errors: string[]; reason?: "no_project" };
