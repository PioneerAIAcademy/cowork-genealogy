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
  // dismissedIssues, conclusionScores, sourceClusters are present upstream but
  // deliberately not modeled — they are excluded from the tool output.
}

export interface FSQualityResponse {
  isValid?: boolean;
  visibility?: string;
  personScores?: FSPersonScores;
}

// ─── Tool I/O ───────────────────────────────────────────────────────────────

export interface PersonQualityInput {
  personId: string;
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

// Option A output (spec Output §): sentences + compact summary + traceable issues.
export interface PersonQualityResult {
  personId: string;
  segment: string | null;
  overallScore: number | null;
  qualityBand: string | null;
  issueCount: number;
  categories: QualityCategoryOut[];
  issues: QualityIssueOut[];
}
