// FamilySearch person-quality-score API response + tool I/O types.
// GET {host}/service/tree/tree-data/quality/person/{personId}/scores
//
// See docs/specs/person-quality-tool-spec.md.

// ─── Upstream (FS) response shapes ──────────────────────────────────────────

// A per-category score block, e.g. completenessScore. Only displayScore is
// read for output; the numerator/denominator fields are carried for reference.
export interface FSCategoryScore {
  rawNumerator?: number;
  displayNumerator?: number;
  denominator?: number;
  displayScore?: number;
  rawScore?: number;
}

// One live issue under personScores.issues[]. issueType + conclusionType drive
// the sentence template; the remaining fields fill placeholders (open-ended,
// varies by issueType — see the templates module).
export interface FSQualityIssue {
  issueType?: string;
  conclusionType?: string;
  scoreType?: string;
  conclusionId?: string;
  [key: string]: unknown;
}

export interface FSPersonScores {
  pid?: string;
  segment?: string;
  visibility?: string;
  overallDisplayScore?: number;
  overallRawScore?: number;
  completenessScore?: FSCategoryScore;
  verifiabilityScore?: FSCategoryScore;
  consistencyScore?: FSCategoryScore;
  coherenceScore?: FSCategoryScore;
  issues?: FSQualityIssue[];
  conclusionScores?: FSConclusionScore[];
  sourceClusters?: FSSourceClusters;
  // dismissedIssues is present upstream but deliberately not modeled — only
  // live (non-dismissed) issues are rendered. conclusionScores/sourceClusters
  // were excluded too until issue #2225 (D2): they are now modeled and surfaced
  // behind the opt-in `detail` flag, so the default payload is unchanged.
}

// One entry per conclusion (NAME, BIRTH, RESIDENCE, …) — the per-fact breakdown
// behind the four category scores. `affectingIssueIds` names which issues drag
// this one fact down, and joins exactly onto `FSQualityIssue.id`.
//
// Shapes below are observed from the live KD96-TV2 body, not from the PDF — see
// dev/probe-person-quality-detail.ts's RESULTS header for the evidence.
export interface FSConclusionScore {
  conclusionId?: string;
  conclusionType?: string;
  affectingIssueIds?: string[];
  combinedDisplayScore?: number;
  combinedRawScore?: number;
  completenessScore?: FSCategoryScore;
  verifiabilityScore?: FSCategoryScore;
  consistencyScore?: FSCategoryScore;
  coherenceScore?: FSCategoryScore;
  // Present only on MARRIAGE entries (2 of 14 on the probed person, and absent
  // from entries 0-2 — which is why the probe prints the union of keys across
  // every entry rather than a sample of the first).
  relationshipId?: string;
}

// NB: `personScores.sourceClusters` is an OBJECT wrapping two lists, not an
// array. The spec documented it as `sourceClusters[]` until #2225; a type
// written from that spec does not compile against the live body.
export interface FSSourceClusters {
  sourceClusters?: FSSourceCluster[];
  conflicts?: FSSourceConflict[];
}

// A group of attached sources. Each source names the conclusions it touches and
// whether it agrees with each. A source may repeat the same conclusion id inside
// its own `conclusions[]` (13 of 28 sources did on the probed person).
export interface FSSourceCluster {
  sources?: FSClusterSource[];
}

export interface FSClusterSource {
  uri?: string;
  title?: string;
  conclusions?: Array<{ id?: string; agreesWithSource?: boolean }>;
}

// Two attached sources that disagree, and about what. Undocumented upstream and
// unmodeled here until #2225. Always exactly two `sourceUris`; the list is
// pairwise, so one underlying disagreement is restated once per source pair
// (50 raw entries reduced to 5 real disagreements on the probed person).
export interface FSSourceConflict {
  sourceUris?: string[];
  conflictingFields?: Array<{ name?: string; values?: string[] }>;
}

export interface FSQualityResponse {
  isValid?: boolean;
  visibility?: string;
  personScores?: FSPersonScores;
}

// ─── Tool I/O ───────────────────────────────────────────────────────────────

export interface PersonQualityInput {
  personId: string;
  /**
   * Opt in to the per-fact and per-source detail (#2225 D2). Off by default so
   * the existing caller's payload is byte-identical — `check-warnings` wants the
   * per-person summary, an audit wants the detail, and the flag is what lets one
   * tool serve both without either paying for the other's context.
   */
  detail?: boolean;
  /**
   * Absolute path of the project folder. Lets a project's local tree id resolve
   * to the person's FamilySearch link (`ark`) so an imported person is scored.
   */
  projectPath?: string;
}

// One rendered issue. The sentence is the primary payload; conclusionType +
// conclusionId make it traceable to the exact fact; scoreType groups it.
export interface QualityIssueOut {
  sentence: string;
  conclusionType?: string;
  conclusionId?: string;
  scoreType?: string;
}

// One score category, in UI order.
export interface QualityCategoryOut {
  scoreType: string;
  count: number;
  score: number | null;
}

// One attached source as it bears on a single fact.
export interface QualityFactSourceOut {
  title: string | null;
  uri: string | null;
  agrees: boolean | null;
}

// One of the person's conclusions (facts), with what drags it down and which
// attached sources touch it. `issues` holds rendered sentences, not raw ids:
// upstream gives `affectingIssueIds`, which join onto `FSQualityIssue.id`, and
// that id is not part of this tool's issue output — so a passthrough would hand
// the caller ids that join to nothing.
export interface QualityFactOut {
  conclusionId: string | null;
  conclusionType: string | null;
  relationshipId?: string;
  score: number | null;
  issues: string[];
  sources: QualityFactSourceOut[];
}

// Two or more attached sources disagreeing about one field, after the pairwise
// upstream list is grouped by (field name, value set).
export interface QualityConflictOut {
  field: string;
  values: string[];
  sources: QualityFactSourceOut[];
}

// Present only when the caller passes `detail: true`.
export interface PersonQualityDetail {
  facts: QualityFactOut[];
  conflicts: QualityConflictOut[];
}

// Output (spec Output §): sentences + compact summary + traceable issues.
export interface PersonQualityResult {
  personId: string;
  segment: string | null;
  overallScore: number | null;
  issueCount: number;
  categories: QualityCategoryOut[];
  issues: QualityIssueOut[];
  /** Opt-in only (`detail: true`). Absent — not empty — when the flag is off. */
  detail?: PersonQualityDetail;
}

/**
 * The answer for an id that is not a FamilySearch person id, returned without a
 * network call. Same `{ ok, reason, errors }` shape as the no-project answer
 * (`utils/project-io.ts` `noProjectResult`, `PersonWarningsResult`).
 */
export interface PersonQualityNotFamilySearchId {
  ok: false;
  reason: "not_familysearch_id";
  errors: string[];
}

export type PersonQualityToolResult =
  | PersonQualityResult
  | PersonQualityNotFamilySearchId;
