/**
 * Tests for lib/compare.ts — arbitrary-pair comparison with snapshot-
 * aware exclusion and corrected-score precedence.
 */
import { describe, it, expect } from 'vitest';
import { buildRunLog } from '../helpers/fixtureTree';
import { compareRunLogs } from '../../lib/compare';
import type { AnnotationFile, RunLogFile } from '../../lib/types';

function snapshotOf(skill: string, tests: number): Record<string, string> {
  const snap: Record<string, string> = {
    [`packages/engine/plugin/skills/${skill}/SKILL.md`]: `body\n`,
    [`eval/tests/unit/${skill}/rubric.md`]: '# rubric\n',
  };
  for (let i = 0; i < tests; i++) {
    snap[`eval/tests/unit/${skill}/t${i}.json`] = `{"test": {"id": "ut_${i}"}}\n`;
  }
  return snap;
}

function buildLog(opts: {
  version: number;
  testIds: string[];
  scores?: number[];
  snapshot?: Record<string, string>;
}): RunLogFile {
  return buildRunLog({
    skill: 'search-familysearch-wiki',
    version: opts.version,
    timestamp: `2026-05-${opts.version.toString().padStart(2, '0')}-00-00-00`,
    snapshot: opts.snapshot ?? snapshotOf('search-familysearch-wiki', opts.testIds.length),
    tests: opts.testIds.map((id, i) => ({
      test_id: id,
      dimensions: [
        { source: 'base', name: 'A', score: ((opts.scores?.[i] ?? 3) as 1 | 2 | 3) },
      ],
    })),
  }) as unknown as RunLogFile;
}

describe('compareRunLogs — headline + rows', () => {
  it('computes weighted-mean delta across comparable tests', () => {
    const recent = buildLog({ version: 2, testIds: ['ut_001', 'ut_002'], scores: [3, 3] });
    const previous = buildLog({ version: 1, testIds: ['ut_001', 'ut_002'], scores: [2, 2] });
    const out = compareRunLogs({
      recent: { log: recent, annotation: null },
      previous: { log: previous, annotation: null },
    });
    expect(out.headline.recentMean).toBe(3);
    expect(out.headline.previousMean).toBe(2);
    expect(out.headline.delta).toBe(1);
    expect(out.headline.comparableCount).toBe(2);
    expect(out.headline.withinVariance).toBe(false);
  });

  it('flags |delta| < 0.3 as within variance', () => {
    const recent = buildLog({ version: 2, testIds: ['ut_001'], scores: [3] });
    const previous = buildLog({ version: 1, testIds: ['ut_001'], scores: [3] });
    const out = compareRunLogs({
      recent: { log: recent, annotation: null },
      previous: { log: previous, annotation: null },
    });
    expect(out.headline.delta).toBe(0);
    expect(out.headline.withinVariance).toBe(true);
  });

  it('marks tests recent-only / previous-only', () => {
    const recent = buildLog({ version: 2, testIds: ['ut_001', 'ut_NEW'] });
    const previous = buildLog({ version: 1, testIds: ['ut_001', 'ut_OLD'] });
    const out = compareRunLogs({
      recent: { log: recent, annotation: null },
      previous: { log: previous, annotation: null },
    });
    const byId = new Map(out.rows.map((r) => [r.test_id, r]));
    expect(byId.get('ut_NEW')!.recentOnly).toBe(true);
    expect(byId.get('ut_OLD')!.previousOnly).toBe(true);
    expect(byId.get('ut_001')!.recentOnly).toBe(false);
    expect(byId.get('ut_001')!.previousOnly).toBe(false);
  });
});

describe('compareRunLogs — edited test exclusion', () => {
  it('flags edited when scenario file content differs in the snapshots', () => {
    const snapA: Record<string, string> = {
      ...snapshotOf('search-familysearch-wiki', 1),
      'eval/fixtures/scenarios/scA/research.json': '{"v": 1}\n',
    };
    const snapB: Record<string, string> = {
      ...snapshotOf('search-familysearch-wiki', 1),
      'eval/fixtures/scenarios/scA/research.json': '{"v": 2}\n',
    };
    const recent = buildRunLog({
      skill: 'search-familysearch-wiki',
      version: 2,
      timestamp: '2026-05-19_00-00-00',
      snapshot: snapB,
      tests: [
        { test_id: 'ut_001', dimensions: [{ source: 'base', name: 'A', score: 3 }] },
      ],
    }) as unknown as RunLogFile;
    recent.tests[0].scenario = 'scA';

    const previous = buildRunLog({
      skill: 'search-familysearch-wiki',
      version: 1,
      timestamp: '2026-05-18_00-00-00',
      snapshot: snapA,
      tests: [
        { test_id: 'ut_001', dimensions: [{ source: 'base', name: 'A', score: 1 }] },
      ],
    }) as unknown as RunLogFile;
    previous.tests[0].scenario = 'scA';

    const out = compareRunLogs({
      recent: { log: recent, annotation: null },
      previous: { log: previous, annotation: null },
    });
    expect(out.rows[0].edited).toBe(true);
    expect(out.headline.comparableCount).toBe(0);
    expect(out.headline.delta).toBeNull();
  });
});

describe('compareRunLogs — corrected-score precedence', () => {
  it('uses corrected_score from annotation when present, llm_score otherwise', () => {
    const recent = buildLog({ version: 2, testIds: ['ut_001'], scores: [3] });
    const previous = buildLog({ version: 1, testIds: ['ut_001'], scores: [3] });

    const recentAnn: AnnotationFile = {
      run_log: 'v2.json',
      annotator: 'team-a',
      corrections: [
        {
          test_id: 'ut_001',
          dimension_source: 'base',
          dimension_name: 'A',
          llm_score: 3,
          corrected_score: 1,
          comment: 'rubric miss',
        },
      ],
    };

    const out = compareRunLogs({
      recent: { log: recent, annotation: recentAnn },
      previous: { log: previous, annotation: null },
    });
    expect(out.headline.recentMean).toBe(1);
    expect(out.headline.previousMean).toBe(3);
    expect(out.headline.delta).toBe(-2);
    expect(out.fallbackToLlmScores).toBe(true);
  });
});

describe('compareRunLogs — snapshot diff panel', () => {
  it('reports added/removed/modified files between snapshots', () => {
    const snapA: Record<string, string> = { 'a.md': 'a\n', 'b.md': 'b\n' };
    const snapB: Record<string, string> = { 'a.md': 'A\n', 'c.md': 'c\n' };
    const recent = buildRunLog({
      skill: 'x',
      version: 2,
      timestamp: '2026-05-19_00-00-00',
      snapshot: snapB,
    }) as unknown as RunLogFile;
    const previous = buildRunLog({
      skill: 'x',
      version: 1,
      timestamp: '2026-05-18_00-00-00',
      snapshot: snapA,
    }) as unknown as RunLogFile;

    const out = compareRunLogs({
      recent: { log: recent, annotation: null },
      previous: { log: previous, annotation: null },
    });

    const byPath = new Map(out.snapshotDiff.map((d) => [d.path, d.kind]));
    expect(byPath.get('a.md')).toBe('modified');
    expect(byPath.get('b.md')).toBe('removed');
    expect(byPath.get('c.md')).toBe('added');
  });
});
