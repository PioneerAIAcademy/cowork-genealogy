/**
 * Shared TypeScript types for the eval app.
 *
 * Mirrors the JSON Schemas under docs/specs/schemas/. The Zod schemas
 * in lib/schema/ (generated) are the runtime validators; this file is
 * the static-typing surface.
 *
 * Run log schema v2: one envelope per harness invocation, wrapping a
 * list of per-test entries. See docs/plan/eval-runlog-versioning.md.
 */

export type UnitTestType = 'positive' | 'negative';
export type ExpectedOutcome = 'pass' | 'xfail';

export interface UnitTestFile {
  test: {
    id: string;
    skill: string;
    name: string;
    type: UnitTestType;
    description: string;
    tags: string[];
    expected_outcome?: ExpectedOutcome;
    xfail_reason?: string;
  };
  input: {
    user_message: string;
    scenario?: string | null;
    scenario_notes?: string | null;
  };
  mcp_fixtures?: string[];
  judge_context: string[];
  negative?: {
    correct_skill: string[];
    explanation: string;
  };
  runs_per_test?: number;
  execution?: {
    max_turns?: number;
    max_wall_clock_seconds?: number;
    max_tool_calls?: number;
    max_input_tokens_per_turn?: number;
  };
}

export type DimensionSource = 'base' | 'rubric';
/** 1 = fail, 2 = partial, 3 = pass, null = N/A (Tool Arguments only). */
export type Score = 1 | 2 | 3 | null;

export interface RunLogDimension {
  source: DimensionSource;
  name: string;
  score: Score;
  rationale: string;
}

export interface RunLogJudgeResults {
  skipped: boolean;
  dimensions: RunLogDimension[];
  judge_cost_usd: number;
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  error?: string | null;
}

export interface RunLogRun {
  run_index: number;
  run_id: string;
  outcome: 'pass' | 'partial' | 'fail' | 'aborted';
  aborted_reason: string | null;
  duration_ms: number;
  judge: RunLogJudgeResults;
  // The orchestrator also writes output/validators/tokens; not all UI
  // surfaces need them, so they're tracked via index signature.
  [key: string]: unknown;
}

export type TestOutcome =
  | 'pass'
  | 'partial'
  | 'fail'
  | 'aborted'
  | 'xfail'
  | 'xpass';

export interface RunLogTotals {
  duration_ms: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  judge_input_tokens: number;
  judge_cached_input_tokens: number;
  judge_output_tokens: number;
  skill_cost_usd: number;
  judge_cost_usd: number;
  total_cost_usd: number;
}

/**
 * Per-test entry inside the run-log envelope. One per test that ran
 * during the invocation.
 */
export interface TestEntry {
  test_id: string;
  test_type: UnitTestType;
  expected_outcome: ExpectedOutcome;
  scenario: string | null;
  mcp_fixtures: string[];
  outcome: TestOutcome;
  flaky: boolean;
  outcome_summary: {
    per_run_outcomes: Array<'pass' | 'partial' | 'fail' | 'aborted'>;
    aggregated_dimensions: RunLogDimension[];
  };
  totals: RunLogTotals;
  runs: RunLogRun[];
}

export type RunInvocation = 'skill' | 'test' | 'all' | 'tag';

/**
 * Run-log envelope (schema v2). Wraps a list of per-test entries with
 * metadata, snapshot, and version info.
 */
export interface RunLogFile {
  schema_version: 2;
  skill: string;
  version: number | null;
  released: boolean;
  releasable: boolean;
  invocation: RunInvocation;
  timestamp: string;
  harness_version: string;
  model: string;
  judge_prompt_hash: string;
  /** {repo-relative-path: normalized content}. */
  snapshot: Record<string, string>;
  tests: TestEntry[];
  totals: RunLogTotals;
}

export interface AnnotationCorrection {
  test_id: string;
  dimension_source: DimensionSource;
  dimension_name: string;
  llm_score: Score;
  corrected_score: Score;
  comment?: string | null;
}

/**
 * One MCP tool call recorded by the mock server during a skill run.
 * Mirrors `tool_call` in docs/specs/schemas/run-log.schema.json.
 */
export interface RunLogToolCall {
  tool: string;
  args: Record<string, unknown>;
  /**
   * The matched fixture's declared `args` block — the canonical
   * expected args for grading. Null when no fixture matched
   * (matched.kind === "none").
   */
  expected_args: Record<string, unknown> | null;
  matched: {
    kind: 'predicate' | 'queue' | 'queue_reused' | 'none';
    index: number | null;
  };
  response_fixture: string | null;
}

/**
 * Sparse annotation file. Entries are present only for dimensions the
 * annotator has explicitly reviewed; missing entries = not reviewed.
 * The CRUD UI's "agree with judge" action creates an entry with
 * `corrected_score === llm_score` and no comment.
 */
export interface AnnotationFile {
  run_log: string;
  annotator: string;
  corrections: AnnotationCorrection[];
}

export interface McpFixtureFile {
  tool: string;
  description: string;
  /**
   * Required non-empty args predicate. Drives dispatch (which fixture
   * answers a given call) AND grading (canonical expected args for the
   * Tool Arguments base dimension). Keys are dotted paths; values are
   * exact-match scalars or `~`-prefixed substring patterns.
   */
  args: Record<string, string | number | boolean | null>;
  input_schema?: unknown;
  response: unknown;
  [key: string]: unknown;
}

export interface ScenarioInfo {
  name: string;
  readme: string | null;
  research: unknown;
  tree: unknown;
}

export interface SkillRubricDimension {
  name: string;
  description: string;
  pass: string | null;
  partial: string | null;
  fail: string | null;
}

export interface SkillInfo {
  name: string;
  description: string | null;
  allowedTools: string[];
  rubricDimensions: SkillRubricDimension[];
  stateless: boolean;
}

export type BlockedReason =
  | { kind: 'missing-scenario'; scenario: string }
  | { kind: 'missing-fixture'; fixture: string }
  | { kind: 'scenario-notes-present'; notes: string };

export interface UnitTestListEntry {
  id: string;
  skill: string;
  name: string;
  type: UnitTestType;
  description: string;
  tags: string[];
  scenario: string | null;
  mcpFixtures: string[];
  filePath: string;
  blocked: BlockedReason | null;
}

/**
 * Run-log classification: released / candidate / scratch / other.
 *
 * - `released` — `v{N}.json`, version is N
 * - `candidate` — `v{N}_<ts>.json`, version is N, timestamp is the ISO
 *   timestamp string (YYYY-MM-DD_HH-MM-SS)
 * - `scratch` — `scratch_<ts>.json`, no version, timestamp set
 * - `other` — unrecognized filename
 */
export type RunLogKind = 'released' | 'candidate' | 'scratch' | 'other';

export interface RunLogClassification {
  kind: RunLogKind;
  version: number | null;
  timestamp: string | null;
}

/**
 * One row on the per-skill results page. Aggregates a multi-test run log
 * down to the fields the list view cares about.
 */
export interface RunLogListEntry {
  /** URL-safe path: `<skill>/<filename-without-ext>` (no model). */
  id: string;
  skill: string;
  /** File classification. */
  kind: RunLogKind;
  version: number | null;
  released: boolean;
  releasable: boolean;
  invocation: RunInvocation;
  timestamp: string;
  model: string;
  /** Number of tests in the envelope. */
  testCount: number;
  /** Weighted mean of aggregated dimension scores across all tests. */
  weightedMean: number | null;
  /** Whether a sibling `.ann.json` exists. */
  annotated: boolean;
  /** Whether every dimension in every test has a correction entry. */
  annotationComplete: boolean;
  filePath: string;
}
