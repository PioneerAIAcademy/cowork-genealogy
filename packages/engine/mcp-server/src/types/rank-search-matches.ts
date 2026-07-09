// rank_search_matches — input + response types.
//
// The tool re-ranks a staged `record_search` result set by match score against
// a tree subject, returning compact gedcomx-free stubs. Spec:
// docs/specs/rank-search-matches-tool-spec.md.

export interface RankSearchMatchesInput {
  /** Absolute path to the active project directory. */
  projectPath: string;
  /**
   * The `staged.resultsRef` handle from `record_search`
   * (`results/.staging/<uuid>.json`). A finalized `results/<log_id>.json` ref is
   * also accepted.
   */
  stagedResultsRef: string;
  /**
   * A `persons[].id` in the project's `tree.gedcomx.json` — the research subject
   * to match every staged candidate against.
   */
  subjectId: string;
  /** How many top-ranked stubs to return. Default 10. */
  top?: number;
  /**
   * When true, fold one batch `source_attachments` call in host-side to set
   * `attachedToSubject` / `attachedToOther` on the returned stubs. Default false.
   */
  checkAttachments?: boolean;
}

/** One returned, match-ranked stub. No gedcomx — the bulk stays off-wire. */
export interface RankedMatch {
  /** 1-based rank by match score (this tool's authoritative ordering). */
  matchRank: number;
  /** The candidate's original 1-based position in the staged set (auditable). */
  searchRank: number;
  /** The record-persona ARK, verbatim from `record_search`'s `recordId`. */
  recordId: string;
  primaryId?: string;
  personName?: string;
  sex?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  collectionTitle?: string;
  recordArk?: string;
  /** 0-1 match score; null when the FS call kept failing (never dropped). */
  matchScore: number | null;
  /** 1-10 confidence bucket; omitted on a no-match / failure. */
  matchConfidence?: number;
  /** Only set when `checkAttachments` and the batch call succeeded. */
  attachedToSubject?: boolean;
  attachedToOther?: boolean;
}

export interface RankSearchMatchesResult {
  subjectId: string;
  /** Candidates scored (full staged set). */
  scoredCount: number;
  /** min(top, scoredCount). */
  returnedCount: number;
  /** Pairs whose FS call kept failing (kept, matchScore null). */
  scoringErrors: number;
  /** Non-null only when the best-effort calibration append failed. */
  scoreLogError: string | null;
  /**
   * Present and `false` only when the subject scores uniformly near-zero against
   * every candidate — a sparse/unresolvable subject. The skill treats this as
   * "no match signal" and falls back to the manual cross-check path.
   */
  subjectResolvable?: boolean;
  matches: RankedMatch[];
}
