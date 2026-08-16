// rank_search_matches — input + response types.
//
// The tool re-ranks a staged `record_search` result set by match score against
// a tree subject, returning compact gedcomx-free stubs. Spec:
// docs/specs/rank-search-matches-tool-spec.md.

import type { RelativeTerms } from "./relative-terms.js";

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
  /** How many facts this candidate record carries that discriminate one human
   *  from another (a date or a place). A thin candidate scores unstably — a
   *  live probe saw two dateless obituary stubs differing only by a middle
   *  initial score 0.086 and 0.668 — so a low count is a signal to corroborate
   *  before trusting the score, in either direction. Reported, never
   *  thresholded: no cutoff separates cleanly. */
  candidateFactCount?: number;
  recordArk?: string;
  /** 0-1 match score; null when the FS call kept failing (never dropped). */
  matchScore: number | null;
  /** 1-10 confidence bucket; omitted on a no-match / failure. */
  matchConfidence?: number;
  /** Only set when `checkAttachments` and the batch call succeeded. */
  attachedToSubject?: boolean;
  attachedToOther?: boolean;
  /** Carried verbatim from the staged row. The ranker neither computes nor
   *  scores it — a scorer that cannot see "father absent" would keep rating
   *  those hits as relative-confirmed, which is why it has to reach the stub
   *  (#1324). */
  relativeTerms?: RelativeTerms;
  /** The extraction batch this record came out of, carried verbatim from the
   *  staged row. Present only on records that trace to one. When a search names
   *  a `subjectId` the caller reads `ranked`, not `results`, so without this the
   *  batch is invisible on the most common call shape (#1592). */
  batchNumber?: string;
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
   * Present and `false` only when no candidate scored above the degenerate
   * floor. Read it together with `diagnostic`, which says WHY — a subject too
   * thin to discriminate (the scores are noise, and `matches` is withheld
   * entirely) versus a scoreable subject against a pool that genuinely holds no
   * match (a real negative worth acting on).
   */
  subjectResolvable?: boolean;
  /** Present whenever `subjectResolvable` is false: what happened and what to
   *  do about it, in the caller's terms. */
  diagnostic?: string;
  /** Facts the subject document gained from the project's own evidence
   *  (assertions linked through `person_evidence`) on top of the bare tree
   *  person. Absent when enrichment contributed nothing. */
  subjectEnrichedFacts?: number;
  /** Alternate names enrichment contributed (name-variant assertions linked
   *  through `person_evidence`). Reported separately from facts because name
   *  variants alone measurably move the score. */
  subjectEnrichedNames?: number;
  /**
   * Present only when the search anchored on a relative AND at least one
   * returned match does not carry that relative. Says so in words, because the
   * match score cannot: it measures name/date/place agreement and is blind to
   * whether the record names the father you searched for. A top-ranked hit with
   * `father: absent` is where that blindness is most dangerous — it looks more
   * confirmed than anything else on the page.
   *
   * Deliberately a note and not a score adjustment. `rank_search_matches` is
   * specced as a re-ranker and review surface, not a classifier; making `absent`
   * move `matchScore` is a scoring-policy change that needs calibration first
   * and would shift every ranking in the eval corpus.
   */
  relativeTermNote?: string;
  matches: RankedMatch[];
}
