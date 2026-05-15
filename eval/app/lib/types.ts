/**
 * Shared TypeScript types for the eval app.
 *
 * These mirror the JSON Schemas under docs/specs/schemas/. The Zod
 * schemas in lib/schema/ (generated) are the runtime validators; this
 * file is the static-typing surface.
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
  additional_criteria: string[];
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

export type DimensionSource = 'base' | 'rubric' | 'criteria';
export type Score = 1 | 2 | 3;

/**
 * Per-dimension judge score on a run log. The schema dictates
 * integer 1-3, but some legacy run logs (committed before the spec
 * switch) carry string enums like "pass"/"partial"/"fail". The
 * reader normalizes to integer at parse time.
 */
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
  // Other fields exist (output, validators, tokens) but the UI only
  // needs the ones above plus the aggregated dimensions.
  [key: string]: unknown;
}

export interface RunLogFile {
  test_id: string;
  skill: string;
  test_type: UnitTestType;
  expected_outcome: ExpectedOutcome;
  timestamp: string;
  harness_version: string;
  model: string;
  judge_model: string;
  rubric_hash: string;
  judge_prompt_hash: string;
  test_content_hash: string;
  scenario: string | null;
  mcp_fixtures: string[];
  outcome: 'pass' | 'partial' | 'fail' | 'aborted' | 'xfail' | 'xpass';
  flaky: boolean;
  outcome_summary: {
    per_run_outcomes: Array<'pass' | 'partial' | 'fail' | 'aborted'>;
    aggregated_dimensions: RunLogDimension[];
  };
  totals: {
    duration_ms: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    skill_cost_usd: number;
    judge_cost_usd: number;
    total_cost_usd: number;
    [key: string]: number;
  };
  runs: RunLogRun[];
}

export interface AnnotationCorrection {
  test_id: string;
  dimension_source: DimensionSource;
  dimension_name: string;
  llm_score: Score;
  corrected_score: Score;
  comment?: string | null;
}

export interface AnnotationFile {
  run_log: string;
  annotator: string;
  corrections: AnnotationCorrection[];
}

export interface McpFixtureFile {
  tool: string;
  description: string;
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

/**
 * Why a test is "blocked" from running, as computed by the data
 * layer. A null status means the test is runnable.
 */
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
 * Run-log list item — the rows on `/results`.
 *
 * `id` is a URL-safe path-derived identifier:
 * `<skill>/<model>/<filename-without-ext>`.
 */
export interface RunLogListEntry {
  id: string;
  skill: string;
  model: string;
  timestamp: string;
  outcome: RunLogFile['outcome'];
  flaky: boolean;
  weightedMean: number | null;
  annotated: boolean;
  testId: string;
  filePath: string;
}
