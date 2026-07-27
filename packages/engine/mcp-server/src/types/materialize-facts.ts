// materialize_facts — I/O types (spec docs/specs/tree-materialization-spec.md §4).
//
// The tool takes REFERENCES only (a persona = recordId + recordRole, plus the
// target personId) and reads the persona's assertions from research.json itself,
// so the LLM never hand-assembles a document and cannot drop the provenance
// chain. Parameter names are camelCase (the MCP wire boundary); the persisted
// tree stays snake_case.

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

export interface MaterializeFactsInput extends Partial<MaterializeFactsOp> {
  /** Absolute path to the project directory (tree.gedcomx.json + research.json). */
  projectPath: string;
  // Batch form — supply ops; when present the single-op fields above are
  // ignored. Every op applies to one in-memory tree; the tool validates once
  // and writes once (all-or-nothing). Ids assigned earlier in the batch are
  // visible to later ops (the allocator rescans the live tree).
  ops?: MaterializeFactsOp[];
}

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
  | { ok: false; errors: string[] };
