/**
 * Cross-run-log comparison logic.
 *
 * Schema v2 update: each run log is a multi-test envelope. Comparison
 * is between two arbitrary envelopes (chosen by the user, defaulting
 * to latest released + latest candidate). Scores come from `.ann.json`
 * `corrected_score` when present; fall back to the run log's
 * `aggregated_dimensions[].score` (the LLM judge's score) when not.
 *
 * Per-test snapshot diff: a test's inputs are considered "edited"
 * between the two envelopes when any of the test's referenced files
 * (its test JSON, scenario, fixtures) differ in the two snapshots.
 *
 * See docs/plan/eval-runlog-versioning.md §B3.
 */
import type {
  AnnotationCorrection,
  AnnotationFile,
  RunLogFile,
  Score,
  TestEntry,
} from './types';

export interface DimensionScore {
  source: string;
  name: string;
  llmScore: Score;
  correctedScore: Score;
  /** True iff the score in the annotation file overrode the LLM score. */
  hasCorrection: boolean;
}

export interface TestSummary {
  test_id: string;
  outcome: TestEntry['outcome'];
  flaky: boolean;
  dimensions: DimensionScore[];
  /** Weighted mean across dimensions, excluding N/A (null) scores. */
  weightedMean: number | null;
  histogram: { 1: number; 2: number; 3: number };
}

export interface ComparisonRow {
  test_id: string;
  recent: TestSummary | null;
  previous: TestSummary | null;
  /** True when the test's inputs (scenario, fixtures, test JSON) differ between the two snapshots. */
  edited: boolean;
  /** True when the test is only in `recent`. */
  recentOnly: boolean;
  /** True when the test is only in `previous`. */
  previousOnly: boolean;
}

export interface ComparisonHeadline {
  comparableCount: number;
  recentMean: number | null;
  previousMean: number | null;
  /** recent - previous (positive = improvement). Null when no comparable tests. */
  delta: number | null;
  /** True when |delta| < 0.3 — advisory only per plan §2.10. */
  withinVariance: boolean;
  /** Sum across all tests on each side. */
  recentHistogram: { 1: number; 2: number; 3: number };
  previousHistogram: { 1: number; 2: number; 3: number };
}

export interface SnapshotDiffEntry {
  path: string;
  /** present-only-in-recent | present-only-in-previous | content-differs */
  kind: 'added' | 'removed' | 'modified';
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  headline: ComparisonHeadline;
  snapshotDiff: SnapshotDiffEntry[];
  /** True when at least one side has no `.ann.json` and we fell back to LLM scores. */
  fallbackToLlmScores: boolean;
}

function correctionKey(c: AnnotationCorrection): string {
  return `${c.test_id}|${c.dimension_source}|${c.dimension_name}`;
}

function summarizeTest(
  entry: TestEntry,
  ann: AnnotationFile | null,
): TestSummary {
  const annByKey = new Map<string, AnnotationCorrection>();
  for (const c of ann?.corrections ?? []) {
    annByKey.set(correctionKey(c), c);
  }

  const dims: DimensionScore[] = entry.outcome_summary.aggregated_dimensions.map((d) => {
    const key = `${entry.test_id}|${d.source}|${d.name}`;
    const correction = annByKey.get(key);
    return {
      source: d.source,
      name: d.name,
      llmScore: d.score,
      correctedScore: correction ? correction.corrected_score : d.score,
      hasCorrection: !!correction,
    };
  });

  // N/A (null) scores are excluded from the weighted mean and the
  // histogram — they represent "no signal to grade" (e.g., Tool
  // Arguments when zero MCP calls happened), not a failing score.
  const numericScores = dims
    .map((d) => d.correctedScore)
    .filter((s): s is 1 | 2 | 3 => s !== null);
  const weightedMean =
    numericScores.length === 0
      ? null
      : numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
  const histogram: { 1: number; 2: number; 3: number } = { 1: 0, 2: 0, 3: 0 };
  for (const s of numericScores) histogram[s] += 1;

  return {
    test_id: entry.test_id,
    outcome: entry.outcome,
    flaky: entry.flaky,
    dimensions: dims,
    weightedMean,
    histogram,
  };
}

/**
 * Files referenced by a single test inside the snapshot. Used to
 * determine whether the test's *inputs* changed between two snapshots.
 */
function filesForTest(entry: TestEntry, skill: string): string[] {
  const out: string[] = [];
  // The test's own definition: try common test filenames. The
  // snapshot's `eval/tests/unit/<skill>/*.json` files include this
  // test, but we don't know which filename maps to which test_id
  // without scanning. Conservative: include EVERY test file under the
  // skill's tests dir, plus the rubric. (Edits to the rubric.md
  // legitimately invalidate dimension comparison, so they count.)
  out.push(`eval/tests/unit/${skill}/rubric.md`);
  // Tests JSON files — we don't know the exact filename per test_id;
  // the snapshot contains all of them, and we count an "edited" test
  // when ANY file under the tests dir changed. This over-flags
  // slightly (renaming an unrelated test would flag this one as
  // "edited") but is safe: the headline excludes edited tests, so the
  // worst case is conservative noise reduction.
  if (entry.scenario) {
    out.push(
      `eval/fixtures/scenarios/${entry.scenario}/research.json`,
      `eval/fixtures/scenarios/${entry.scenario}/tree.gedcomx.json`,
      `eval/fixtures/scenarios/${entry.scenario}/README.md`,
    );
  }
  for (const f of entry.mcp_fixtures) {
    out.push(`eval/fixtures/mcp/${f}.json`);
  }
  return out;
}

function testEdited(
  entry: TestEntry,
  recentSnap: Record<string, string>,
  previousSnap: Record<string, string>,
  skill: string,
): boolean {
  for (const file of filesForTest(entry, skill)) {
    const a = recentSnap[file];
    const b = previousSnap[file];
    if (a === undefined && b === undefined) continue;
    if (a !== b) return true;
  }
  // Also: did any test JSON change inside eval/tests/unit/<skill>/?
  const prefix = `eval/tests/unit/${skill}/`;
  const allRecentTestKeys = Object.keys(recentSnap).filter(
    (k) => k.startsWith(prefix) && k.endsWith('.json'),
  );
  const allPreviousTestKeys = Object.keys(previousSnap).filter(
    (k) => k.startsWith(prefix) && k.endsWith('.json'),
  );
  if (allRecentTestKeys.length !== allPreviousTestKeys.length) return true;
  for (const k of allRecentTestKeys) {
    if (recentSnap[k] !== previousSnap[k]) return true;
  }
  return false;
}

function diffSnapshots(
  recent: Record<string, string>,
  previous: Record<string, string>,
): SnapshotDiffEntry[] {
  const out: SnapshotDiffEntry[] = [];
  const all = new Set([...Object.keys(recent), ...Object.keys(previous)]);
  for (const p of [...all].sort()) {
    const a = recent[p];
    const b = previous[p];
    if (a === undefined) out.push({ path: p, kind: 'removed' });
    else if (b === undefined) out.push({ path: p, kind: 'added' });
    else if (a !== b) out.push({ path: p, kind: 'modified' });
  }
  return out;
}

export interface CompareInput {
  recent: { log: RunLogFile; annotation: AnnotationFile | null };
  previous: { log: RunLogFile; annotation: AnnotationFile | null };
}

/**
 * Build a side-by-side comparison of two run logs.
 *
 * - Scores prefer `.ann.json` `corrected_score`; fall back to the
 *   run log's `aggregated_dimensions[].score` for dimensions without
 *   an explicit correction entry. Dimensions agreed-by-default are
 *   indistinguishable from agreed-explicitly under this model — that
 *   matches the sparse-ann.json semantics intentionally.
 * - Tests whose inputs differ between snapshots are flagged `edited`
 *   and excluded from the headline.
 * - Histograms cover every dimension on each side regardless of edit
 *   status — they describe the runs as scored, not the comparable set.
 */
export function compareRunLogs(input: CompareInput): ComparisonResult {
  const skill = input.recent.log.skill;
  const recentTests = new Map(input.recent.log.tests.map((t) => [t.test_id, t]));
  const previousTests = new Map(input.previous.log.tests.map((t) => [t.test_id, t]));
  const allIds = new Set([...recentTests.keys(), ...previousTests.keys()]);

  const recentAnnByKey = new Map<string, AnnotationCorrection>();
  for (const c of input.recent.annotation?.corrections ?? []) {
    recentAnnByKey.set(correctionKey(c), c);
  }
  const previousAnnByKey = new Map<string, AnnotationCorrection>();
  for (const c of input.previous.annotation?.corrections ?? []) {
    previousAnnByKey.set(correctionKey(c), c);
  }

  const rows: ComparisonRow[] = [];
  for (const test_id of [...allIds].sort()) {
    const rEntry = recentTests.get(test_id) ?? null;
    const pEntry = previousTests.get(test_id) ?? null;
    const recentSummary = rEntry ? summarizeTest(rEntry, input.recent.annotation) : null;
    const previousSummary = pEntry
      ? summarizeTest(pEntry, input.previous.annotation)
      : null;

    let edited = false;
    if (rEntry && pEntry) {
      edited = testEdited(rEntry, input.recent.log.snapshot, input.previous.log.snapshot, skill);
    }

    rows.push({
      test_id,
      recent: recentSummary,
      previous: previousSummary,
      edited,
      recentOnly: rEntry !== null && pEntry === null,
      previousOnly: rEntry === null && pEntry !== null,
    });
  }

  const comparable = rows.filter(
    (r) => r.recent && r.previous && !r.edited,
  );
  const recentMean =
    comparable.length === 0
      ? null
      : comparable.reduce((acc, r) => acc + (r.recent!.weightedMean ?? 0), 0) / comparable.length;
  const previousMean =
    comparable.length === 0
      ? null
      : comparable.reduce((acc, r) => acc + (r.previous!.weightedMean ?? 0), 0) / comparable.length;
  const delta = recentMean !== null && previousMean !== null ? recentMean - previousMean : null;

  const recentHistogram = { 1: 0, 2: 0, 3: 0 };
  const previousHistogram = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows) {
    if (r.recent) {
      for (const k of [1, 2, 3] as const) recentHistogram[k] += r.recent.histogram[k];
    }
    if (r.previous) {
      for (const k of [1, 2, 3] as const) previousHistogram[k] += r.previous.histogram[k];
    }
  }

  const fallbackToLlmScores = !input.recent.annotation || !input.previous.annotation;

  return {
    rows,
    headline: {
      comparableCount: comparable.length,
      recentMean,
      previousMean,
      delta,
      withinVariance: delta !== null && Math.abs(delta) < 0.3,
      recentHistogram,
      previousHistogram,
    },
    snapshotDiff: diffSnapshots(input.recent.log.snapshot, input.previous.log.snapshot),
    fallbackToLlmScores,
  };
}
