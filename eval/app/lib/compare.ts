/**
 * Pure comparison logic. Stays out of the API layer so it can be
 * unit-tested directly against fixture run-log pairs.
 *
 * Input: a list of run logs in `<skill>/<model>/` sorted timestamp
 * desc.
 * Output: per-test recent/previous rows + headline weighted-mean.
 */
import type { RunLogFile, RunLogDimension } from './types';

export interface ComparisonRow {
  test_id: string;
  recent: RunLogSummary;
  previous: RunLogSummary | null;
  /** True when test_content_hash differs (or is missing on either side). */
  edited: boolean;
  /** True when the test exists only on the recent side (new test). */
  recentOnly: boolean;
  /** True when the test exists only on the previous side (removed). */
  previousOnly: boolean;
}

export interface RunLogSummary {
  timestamp: string;
  outcome: RunLogFile['outcome'];
  flaky: boolean;
  weightedMean: number | null;
  histogram: { 1: number; 2: number; 3: number };
  test_content_hash: string;
  dimensions: RunLogDimension[];
}

export interface ComparisonHeadline {
  comparableCount: number;
  recentMean: number | null;
  previousMean: number | null;
  /** recent - previous (positive = improvement). Null when no comparable tests. */
  delta: number | null;
  /** True when |delta| < 0.3 — advisory only per plan §2.10. */
  withinVariance: boolean;
}

export interface ComparisonResult {
  rows: ComparisonRow[];
  headline: ComparisonHeadline;
  /** Single-row situations the UI surfaces as empty-state messages. */
  emptyState: 'no-runs' | 'single-run' | null;
}

function weightedMean(dims: RunLogDimension[]): number | null {
  if (dims.length === 0) return null;
  return dims.reduce((acc, d) => acc + d.score, 0) / dims.length;
}

function histogram(dims: RunLogDimension[]): { 1: number; 2: number; 3: number } {
  const h: { 1: number; 2: number; 3: number } = { 1: 0, 2: 0, 3: 0 };
  for (const d of dims) h[d.score] += 1;
  return h;
}

function summarize(log: RunLogFile): RunLogSummary {
  const dims = log.outcome_summary.aggregated_dimensions;
  return {
    timestamp: log.timestamp,
    outcome: log.outcome,
    flaky: log.flaky,
    weightedMean: weightedMean(dims),
    histogram: histogram(dims),
    test_content_hash: log.test_content_hash ?? '',
    dimensions: dims,
  };
}

/**
 * Given run logs in a directory (assumed pre-sorted timestamp desc),
 * group by test_id and pair recent+previous. Sets `edited` when either
 * side is missing a hash or the hashes differ (per plan: safer default
 * is "edited" — exclude from headline).
 */
export function compareRunLogs(runs: Array<{ log: RunLogFile }>): ComparisonResult {
  if (runs.length === 0) {
    return { rows: [], headline: emptyHeadline(), emptyState: 'no-runs' };
  }

  const byTest = new Map<string, Array<{ log: RunLogFile }>>();
  for (const r of runs) {
    const arr = byTest.get(r.log.test_id) ?? [];
    arr.push(r);
    byTest.set(r.log.test_id, arr);
  }

  const rows: ComparisonRow[] = [];
  for (const [test_id, arr] of byTest.entries()) {
    const sorted = [...arr].sort((a, b) => (a.log.timestamp < b.log.timestamp ? 1 : -1));
    const recent = summarize(sorted[0].log);
    const previous = sorted[1] ? summarize(sorted[1].log) : null;
    const edited = previous
      ? !recent.test_content_hash || !previous.test_content_hash || recent.test_content_hash !== previous.test_content_hash
      : false;
    rows.push({
      test_id,
      recent,
      previous,
      edited,
      recentOnly: previous === null,
      previousOnly: false,
    });
  }
  rows.sort((a, b) => a.test_id.localeCompare(b.test_id));

  // Headline: only over non-edited rows with both sides present.
  const comparable = rows.filter((r) => r.previous && !r.edited);

  if (rows.every((r) => r.previous === null)) {
    return {
      rows,
      headline: emptyHeadline(),
      emptyState: 'single-run',
    };
  }

  const recentMean =
    comparable.length === 0 ? null : comparable.reduce((acc, r) => acc + (r.recent.weightedMean ?? 0), 0) / comparable.length;
  const previousMean =
    comparable.length === 0
      ? null
      : comparable.reduce((acc, r) => acc + (r.previous!.weightedMean ?? 0), 0) / comparable.length;
  const delta = recentMean !== null && previousMean !== null ? recentMean - previousMean : null;

  return {
    rows,
    headline: {
      comparableCount: comparable.length,
      recentMean,
      previousMean,
      delta,
      withinVariance: delta !== null && Math.abs(delta) < 0.3,
    },
    emptyState: null,
  };
}

function emptyHeadline(): ComparisonHeadline {
  return {
    comparableCount: 0,
    recentMean: null,
    previousMean: null,
    delta: null,
    withinVariance: false,
  };
}
