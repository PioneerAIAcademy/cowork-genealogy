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

export interface MaterializeFactsInput {
  /** Absolute path to the project directory (tree.gedcomx.json + research.json). */
  projectPath: string;
  /** Target tree person. May name a person that does not yet exist — the tool
   *  mints it from the persona's name/gender assertions (create-or-enrich).
   *  Omit to let the tool allocate the next `I` id for a brand-new person. */
  personId?: string;
  /** The record the persona belongs to (matches assertion.record_id). */
  recordId: string;
  /** The persona's role on that record (matches assertion.record_role). */
  recordRole: string;
}

/** Compact summary — never an echo of the written tree JSON (§4.1). */
export type MaterializeFactsResult =
  | {
      ok: true;
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
      filesWritten: string[];
      validation: { valid: true; warnings: string[] };
    }
  | { ok: false; errors: string[] };
