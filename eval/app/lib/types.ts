/**
 * Shared TypeScript types for the eval app.
 *
 * Mirrors the JSON Schemas under docs/specs/schemas/. The Zod schemas
 * in lib/schema/ (generated) are the runtime validators; this file is
 * the static-typing surface.
 *
 * Run log schema v3: one envelope per harness invocation, wrapping a
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
    holdout?: boolean;
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
  judge_reads_files?: boolean;
}

export type DimensionSource = 'base' | 'rubric';
/** 1 = fail, 2 = partial, 3 = pass, null = N/A (Tool Arguments only). */
export type Score = 1 | 2 | 3 | null;

/**
 * Names of the base dimensions the LLM judge is required to emit. Mirrors
 * `_REQUIRED_BASE_DIMENSIONS` in `eval/harness/harness/judge.py`. A rename
 * here MUST be made in three places: this constant, the Python tuple, and
 * the corresponding heading in `eval/harness/judge/prompt.md`.
 */
export const BASE_DIMENSIONS = {
  CORRECTNESS: 'Correctness',
  COMPLETENESS: 'Completeness',
  TOOL_ARGUMENTS: 'Tool Arguments',
} as const;

/** Base dimensions whose score may be null (N/A). Mirrors
 *  `_NULLABLE_BASE_DIMENSIONS` in the Python judge. */
export const NULLABLE_BASE_DIMENSIONS: ReadonlySet<string> = new Set([
  BASE_DIMENSIONS.TOOL_ARGUMENTS,
]);

/**
 * Whether the annotation score picker should offer an `N/A` (null) option
 * for a dimension. Two independent reasons:
 *
 *  1. The judge itself scored the dimension `null` — the reviewer must be
 *     able to *agree* with that N/A. This is not limited to base dimensions:
 *     a rubric dimension with an N/A criterion (e.g. check-warnings'
 *     "Actionability"/"Severity classification" when the project is clean)
 *     legitimately comes back null. Without this, the picker only offers
 *     1/2/3 and the reviewer is forced to pick 3, manufacturing a
 *     null-vs-3 "disagreement" that is really just a UI gap.
 *  2. It is a nullable base dimension (Tool Arguments) — the reviewer may
 *     set *or override to* N/A even when the judge emitted a 1/2/3.
 */
/**
 * The tests a run log's annotation must cover, or `null` for "all of them".
 *
 * A run log written before sampling shipped — every committed one today — has
 * no `review_sample` and keeps the original every-dimension rule. Keep this the
 * single definition: a private second copy in `lib/fs/runlogs.ts` is exactly
 * what let the run-log list badge and the release gate disagree on one file.
 *
 * Lives here rather than in `lib/fs/` because the scoring page is a client
 * component and must not pull in `node:fs`.
 */
export function sampledTestIds(log: RunLogFile): Set<string> | null {
  const sample = log.review_sample;
  if (!sample) return null;
  const ids = new Set(sample.tests ?? []);
  // Fail CLOSED on anything untrustworthy, mirroring `check_runlogs.py`'s
  // THREE guards. Failing open here is worse than in CI: an untrusted sample
  // renders every test `not sampled`, makes `unreviewedDimensions` return
  // nothing, and reports the annotation complete — so the UI green-lights a
  // release that CI then rejects. That is the same UI-vs-CI split deleting the
  // duplicate `isAnnotationComplete` was meant to end, and shipping two of the
  // three guards reopened it for the third case.
  const known = new Set(log.tests.map((t) => t.test_id));
  for (const id of ids) if (!known.has(id)) return null;
  // A sample naming only tests whose judge was skipped would require nothing —
  // and this also covers an EMPTY sample, since `.some()` over no ids is false.
  // An explicit `ids.size === 0` guard was tried here and was unreachable: it
  // left its own test unable to fail, the same way three redundant guards did
  // in `apply_routing_deference`. The Python side keeps its equivalent only
  // because it emits a different warning message.
  const gradeable = new Set(
    log.tests
      .filter((t) => t.outcome_summary.aggregated_dimensions.length > 0)
      .map((t) => t.test_id),
  );
  if (![...ids].some((id) => gradeable.has(id))) return null;
  return ids;
}

/**
 * Sampled corrections that owe a written comment and do not have one.
 *
 * Cutting the pass ~3x is only worth having if the remaining cells are actually
 * read, and a sentence is what makes that real. But a **confirmed pass** (judge
 * 3, human agrees 3) is exempt: 8,717 of 9,753 corrections in the corpus
 * (89.4%) are 3 -> 3, so requiring one there spends ~26 of every ~29 sentences
 * on the cells least likely to carry anything. With the exemption a run needs
 * ~3 sentences instead of ~29.
 *
 * The known cost, accepted: a shared false negative lives exactly in a
 * confirmed 3 — ut_search_records_013 was judge-3 / human-3 five times on runs
 * that violated the skill's own prohibitions. A comment mandate was never a
 * strong guard there ("looks fine" satisfies it), so the targeted slot is what
 * has to catch that class.
 *
 * Unsampled tests are exempt: nothing is asked of them, so a stray correction
 * there is a bonus, not a debt.
 *
 * Lives here rather than in `lib/fs/` for the same reason as `sampledTestIds`:
 * the scoring page is a client component and must not pull in `node:fs`.
 */
/** A grade the reviewer agreed with that asserts nothing went wrong: a pass, or
 *  an N/A meaning the dimension never applied. Both are exempt from the comment
 *  rule — 8,717 of 9,753 corrections are 3 -> 3 and 700 more are null -> null,
 *  91% of them silent today, so requiring a sentence there is most of the cost
 *  for the least likely yield. A confirmed 2 or 1 is NOT exempt: agreeing that
 *  something went wrong is exactly when the reviewer should say what. */
export function isConfirmedNonFailing(llm: Score, corrected: Score): boolean {
  return llm === corrected && (llm === 3 || llm === null);
}

/**
 * Whether this test owes comments at all — i.e. it is in a TRUSTED sample.
 *
 * Distinct from "must this test be reviewed", which is true for every test on a
 * pre-sampling run log. Conflating the two made the comment rule fire on all 121
 * committed run logs, where CI asks for nothing: every non-pass correction went
 * red, "Next test" locked, and "Agree All" vanished — while the page's own
 * Release gate reported the annotation complete. Two meanings, two predicates.
 */
export function testOwesComments(log: RunLogFile, testId: string): boolean {
  const sampled = sampledTestIds(log);
  return sampled !== null && sampled.has(testId);
}

export function uncommentedSampledCorrections(
  log: RunLogFile,
  ann: AnnotationFile | null,
): Array<{ test_id: string; dimension_source: string; dimension_name: string }> {
  const sampled = sampledTestIds(log);
  if (!sampled) return []; // pre-sampling run log — the old rule, no comment debt
  return (ann?.corrections ?? [])
    .filter(
      (c) =>
        sampled.has(c.test_id) &&
        !(c.comment ?? '').trim() &&
        !isConfirmedNonFailing(c.llm_score, c.corrected_score),
    )
    .map((c) => ({
      test_id: c.test_id,
      dimension_source: c.dimension_source,
      dimension_name: c.dimension_name,
    }));
}

export function dimensionAllowsNa(
  source: DimensionSource,
  name: string,
  judgeScore: Score,
): boolean {
  return (
    judgeScore === null ||
    (source === 'base' && NULLABLE_BASE_DIMENSIONS.has(name))
  );
}

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
  /** Wall-clock of the judge LLM call, ms. Absent in pre-instrumentation logs. */
  duration_ms?: number;
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
  /** Harness wall-clock of the skill run (message-consume loop), ms. */
  duration_ms: number;
  /** SDK API/network time, ms. Absent in pre-instrumentation logs. */
  duration_api_ms?: number;
  /** SDK turn count. Absent in pre-instrumentation logs. */
  num_turns?: number;
  /** Skill-execution attempts; >1 means transient stall/error retries. */
  skill_attempts?: number;
  /** Epoch seconds bracketing the whole run. Absent for never-executed runs. */
  started_at?: number;
  ended_at?: number;
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
  /** Sum of per-run SDK API/network time, ms. Absent in pre-instrumentation logs. */
  duration_api_ms?: number;
  /** Sum of per-run judge LLM call wall-clock, ms. Absent in pre-instrumentation logs. */
  judge_duration_ms?: number;
  /** Sum of per-run SDK turn counts. Absent in pre-instrumentation logs. */
  num_turns?: number;
  /** True makespan max(ended_at)-min(started_at), ms. Absent in pre-instrumentation logs. */
  wall_clock_ms?: number;
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

export type RunInvocation = 'skill' | 'test' | 'tag';

/**
 * Run-log envelope (schema v3). Wraps a list of per-test entries with
 * metadata, snapshot, and version info.
 */
/**
 * Which tests a run log's annotation must cover. Absent on every run log
 * written before sampling shipped, and on scratch/partial writes — readers
 * treat absence as "every dimension of every test". Produced by the harness's
 * `review_sample.py`; `cursor` is the rotation state, carried here because
 * candidate pruning destroys the annotation history it would otherwise be
 * derived from.
 */
export interface ReviewSample {
  tests: string[];
  cursor: string[];
  seed: number;
}

export interface RunLogFile {
  schema_version: 3;
  skill: string;
  version: number | null;
  released: boolean;
  releasable: boolean;
  invocation: RunInvocation;
  timestamp: string;
  harness_version: string;
  model: string;
  review_sample?: ReviewSample;
  judge_prompt_hash: string;
  /** {repo-relative-path: sha256-of-normalized-content}. Digests, not bytes. */
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
  holdout: boolean;
  /** Schema default `pass`; `xfail` marks a known-failing test. */
  expectedOutcome: ExpectedOutcome;
  /** Why the test is marked xfail. Null unless expectedOutcome is `xfail`. */
  xfailReason: string | null;
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
