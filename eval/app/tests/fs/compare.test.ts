import { describe, it, expect } from 'vitest';
import { compareRunLogs } from '../../lib/compare';
import type { RunLogFile } from '../../lib/types';

function makeRunLog(opts: {
  test_id: string;
  timestamp: string;
  hash: string;
  dims?: Array<{ source: 'base' | 'rubric' | 'criteria'; name: string; score: 1 | 2 | 3 }>;
  outcome?: RunLogFile['outcome'];
}): RunLogFile {
  const dims = (opts.dims ?? [
    { source: 'base', name: 'Correctness', score: 3 },
    { source: 'rubric', name: 'A', score: 3 },
    { source: 'criteria', name: 'B', score: 2 },
  ]).map((d) => ({ ...d, rationale: '' }));
  return {
    test_id: opts.test_id,
    skill: 's',
    test_type: 'positive',
    expected_outcome: 'pass',
    timestamp: opts.timestamp,
    harness_version: '0.1.0',
    model: 'm',
    judge_model: 'jm',
    rubric_hash: 'a'.repeat(64),
    judge_prompt_hash: 'b'.repeat(64),
    test_content_hash: opts.hash,
    scenario: null,
    mcp_fixtures: [],
    outcome: opts.outcome ?? 'pass',
    flaky: false,
    outcome_summary: { per_run_outcomes: [opts.outcome ?? 'pass'], aggregated_dimensions: dims },
    totals: {
      duration_ms: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      skill_cost_usd: 0,
      judge_cost_usd: 0,
      total_cost_usd: 0,
    },
    runs: [],
  };
}

describe('compareRunLogs — four edge cases (plan §critical-path)', () => {
  it('0 run logs → no-runs empty state', () => {
    const result = compareRunLogs([]);
    expect(result.emptyState).toBe('no-runs');
    expect(result.rows).toEqual([]);
    expect(result.headline.delta).toBeNull();
  });

  it('1 run log → single-run empty state', () => {
    const result = compareRunLogs([{ log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h1' }) }]);
    expect(result.emptyState).toBe('single-run');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].previous).toBeNull();
    expect(result.rows[0].recentOnly).toBe(true);
  });

  it('tests present in only one side are surfaced as recent-only / previous-only', () => {
    const result = compareRunLogs([
      // T1 has two runs, T2 only has the recent run.
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h1' }) },
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-12T00:00:00Z', hash: 'h1' }) },
      { log: makeRunLog({ test_id: 'ut_t_new', timestamp: '2026-05-13T00:00:00Z', hash: 'h-new' }) },
    ]);
    expect(result.rows).toHaveLength(2);
    const t1 = result.rows.find((r) => r.test_id === 'ut_t_001')!;
    const tNew = result.rows.find((r) => r.test_id === 'ut_t_new')!;
    expect(t1.previous).not.toBeNull();
    expect(t1.edited).toBe(false);
    expect(tNew.previous).toBeNull();
    expect(tNew.recentOnly).toBe(true);

    // Headline mean computed only over comparable (non-edited, both-sides-present) rows.
    expect(result.headline.comparableCount).toBe(1);
    expect(result.headline.recentMean).toBeCloseTo(result.headline.previousMean!, 5);
    expect(result.headline.delta).toBeCloseTo(0, 5);
  });

  it('zero overlapping after edits/single-side → headline suppressed', () => {
    const result = compareRunLogs([
      // T1: hash changed between runs → edited → excluded from headline.
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h-new' }) },
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-12T00:00:00Z', hash: 'h-old' }) },
      // T2: recent-only (new test) → excluded.
      { log: makeRunLog({ test_id: 'ut_t_002', timestamp: '2026-05-13T00:00:00Z', hash: 'h-x' }) },
    ]);
    expect(result.headline.comparableCount).toBe(0);
    expect(result.headline.recentMean).toBeNull();
    expect(result.headline.previousMean).toBeNull();
    expect(result.headline.delta).toBeNull();
  });
});

describe('compareRunLogs — within-variance advisory', () => {
  it('flags within-variance when |delta| < 0.3', () => {
    // recent mean = 3.0, previous mean = 2.8 → delta 0.2 → within.
    const result = compareRunLogs([
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h', dims: [
        { source: 'base', name: 'A', score: 3 }, { source: 'base', name: 'B', score: 3 }, { source: 'base', name: 'C', score: 3 }, { source: 'base', name: 'D', score: 3 }, { source: 'base', name: 'E', score: 3 },
      ] }) },
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-12T00:00:00Z', hash: 'h', dims: [
        { source: 'base', name: 'A', score: 3 }, { source: 'base', name: 'B', score: 3 }, { source: 'base', name: 'C', score: 3 }, { source: 'base', name: 'D', score: 3 }, { source: 'base', name: 'E', score: 2 },
      ] }) },
    ]);
    expect(result.headline.delta).toBeCloseTo(0.2, 5);
    expect(result.headline.withinVariance).toBe(true);
  });

  it('does not flag when |delta| >= 0.3', () => {
    const result = compareRunLogs([
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h', dims: [{ source: 'base', name: 'A', score: 3 }, { source: 'base', name: 'B', score: 3 }] }) },
      { log: makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-12T00:00:00Z', hash: 'h', dims: [{ source: 'base', name: 'A', score: 2 }, { source: 'base', name: 'B', score: 2 }] }) },
    ]);
    expect(result.headline.delta).toBeCloseTo(1.0, 5);
    expect(result.headline.withinVariance).toBe(false);
  });
});

describe('compareRunLogs — edited flag (missing hash treated as edited)', () => {
  it('treats missing hash on either side as edited (safer default)', () => {
    const recent = makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-13T00:00:00Z', hash: 'h-new' });
    const previous = makeRunLog({ test_id: 'ut_t_001', timestamp: '2026-05-12T00:00:00Z', hash: '' });
    const result = compareRunLogs([{ log: recent }, { log: previous }]);
    expect(result.rows[0].edited).toBe(true);
  });
});
