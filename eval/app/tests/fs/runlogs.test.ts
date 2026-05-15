import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFixtureTree, type FixtureTreeHandle } from '../helpers/fixtureTree';
import { listRunLogs, readRunLogById, listRunLogsInDir, runLogWeightedMean } from '../../lib/fs/runlogs';

function makeRunLog(opts: {
  test_id: string;
  skill: string;
  timestamp: string;
  outcome?: 'pass' | 'partial' | 'fail';
  /** When omitted, defaults to a 3/3/2 grid (weighted-mean ~2.67). */
  dims?: Array<{ source: 'base' | 'rubric' | 'criteria'; name: string; score: 1 | 2 | 3; rationale?: string }>;
  judgeSkipped?: boolean;
}): Record<string, unknown> {
  const dims = opts.dims ?? [
    { source: 'base', name: 'Correctness', score: 3 },
    { source: 'rubric', name: 'A', score: 3 },
    { source: 'criteria', name: 'B', score: 2 },
  ];
  return {
    test_id: opts.test_id,
    skill: opts.skill,
    test_type: 'positive',
    expected_outcome: 'pass',
    timestamp: opts.timestamp,
    harness_version: '0.1.0',
    model: 'claude-sonnet-4-6',
    judge_model: 'claude-haiku-4-5-20251001',
    rubric_hash: 'a'.repeat(64),
    judge_prompt_hash: 'b'.repeat(64),
    test_content_hash: 'c'.repeat(64),
    scenario: null,
    mcp_fixtures: [],
    outcome: opts.outcome ?? 'pass',
    flaky: false,
    outcome_summary: {
      per_run_outcomes: [opts.outcome ?? 'pass'],
      aggregated_dimensions: dims,
    },
    totals: {
      duration_ms: 1000,
      input_tokens: 100,
      cached_input_tokens: 50,
      output_tokens: 20,
      skill_cost_usd: 0.01,
      judge_cost_usd: 0.001,
      total_cost_usd: 0.011,
    },
    runs: [
      {
        run_index: 0,
        run_id: `run_${opts.test_id}_0`,
        outcome: opts.outcome ?? 'pass',
        aborted_reason: null,
        duration_ms: 1000,
        input_tokens: 100,
        cached_input_tokens: 50,
        output_tokens: 20,
        skill_cost_usd: 0.01,
        output: { text_response: '', activated: true, skills_invoked: [], tool_calls: [], files_created: [] },
        validators: { passed: true, results: [] },
        judge: {
          skipped: opts.judgeSkipped ?? false,
          dimensions: dims,
          judge_cost_usd: 0.001,
          error: opts.judgeSkipped ? 'judge crashed' : null,
        },
      },
    ],
  };
}

describe('runlogs — happy path', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-13T09-30-52Z.json',
          body: makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-13T09:30:52Z' }),
          annotation: {
            run_log: '2026-05-13T09-30-52Z.json',
            annotator: 'team-a',
            corrections: [],
          },
        },
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-12T09-30-52Z.json',
          body: makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-12T09:30:52Z' }),
        },
        {
          skill: 'locality-guide',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-14T09-30-52Z.json',
          body: makeRunLog({ test_id: 'ut_locality_guide_001', skill: 'locality-guide', timestamp: '2026-05-14T09:30:52Z' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('lists all run logs sorted timestamp desc', async () => {
    const { runs, corrupt } = await listRunLogs();
    expect(corrupt).toEqual([]);
    expect(runs.map((r) => r.timestamp)).toEqual(['2026-05-14T09:30:52Z', '2026-05-13T09:30:52Z', '2026-05-12T09:30:52Z']);
    expect(runs[0].id).toBe('locality-guide/claude-sonnet-4-6/2026-05-14T09-30-52Z');
  });

  it('filters by skill', async () => {
    const { runs } = await listRunLogs({ skill: 'wiki-lookup' });
    expect(runs.every((r) => r.skill === 'wiki-lookup')).toBe(true);
    expect(runs).toHaveLength(2);
  });

  it('filters by annotated status', async () => {
    const { runs: annotated } = await listRunLogs({ annotated: true });
    expect(annotated).toHaveLength(1);
    expect(annotated[0].timestamp).toBe('2026-05-13T09:30:52Z');

    const { runs: unannotated } = await listRunLogs({ annotated: false });
    expect(unannotated).toHaveLength(2);
  });

  it('reads a single run log by id', async () => {
    const found = await readRunLogById('wiki-lookup/claude-sonnet-4-6/2026-05-13T09-30-52Z');
    expect(found?.runLog.test_id).toBe('ut_wiki_lookup_001');
  });

  it('weighted mean reflects integer scores', async () => {
    const found = await readRunLogById('wiki-lookup/claude-sonnet-4-6/2026-05-13T09-30-52Z');
    expect(runLogWeightedMean(found!.runLog)).toBeCloseTo((3 + 3 + 2) / 3, 5);
  });
});

describe('runlogs — malformed run-log JSON', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-14T00-00-00Z.json',
          body: makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-14T00:00:00Z' }),
        },
      ],
      corruptRunlogs: [
        { skill: 'wiki-lookup', model: 'claude-sonnet-4-6', filename: '2026-05-15T00-00-00Z.json', body: '{not valid json' },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('skips the bad file and reports it in `corrupt`', async () => {
    const { runs, corrupt } = await listRunLogs();
    expect(runs).toHaveLength(1);
    expect(corrupt).toHaveLength(1);
    expect(corrupt[0]).toMatch(/2026-05-15T00-00-00Z\.json$/);
  });
});

describe('runlogs — legacy string-enum scores normalize to integers', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    const legacy = makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-14T00:00:00Z' });
    // Mutate to the legacy enum format committed prior to the spec switch.
    (legacy.outcome_summary as { aggregated_dimensions: Array<{ score: unknown }> }).aggregated_dimensions = [
      { source: 'base', name: 'Correctness', score: 'pass', rationale: '' } as never,
      { source: 'rubric', name: 'A', score: 'partial', rationale: '' } as never,
      { source: 'criteria', name: 'B', score: 'fail', rationale: '' } as never,
    ];
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-14T00-00-00Z.json',
          body: legacy,
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('translates pass/partial/fail to 3/2/1', async () => {
    const { runs } = await listRunLogs();
    expect(runs[0].weightedMean).toBeCloseTo((3 + 2 + 1) / 3, 5);
  });
});

describe('runlogs — listRunLogsInDir', () => {
  let handle: FixtureTreeHandle;

  beforeEach(async () => {
    handle = await makeFixtureTree({
      runlogs: [
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-12T00-00-00Z.json',
          body: makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-12T00:00:00Z' }),
        },
        {
          skill: 'wiki-lookup',
          model: 'claude-sonnet-4-6',
          filename: '2026-05-13T00-00-00Z.json',
          body: makeRunLog({ test_id: 'ut_wiki_lookup_001', skill: 'wiki-lookup', timestamp: '2026-05-13T00:00:00Z' }),
        },
      ],
    });
    process.env.EVAL_DIR = handle.root;
  });

  afterEach(async () => {
    delete process.env.EVAL_DIR;
    await handle.cleanup();
  });

  it('returns runs sorted timestamp desc', async () => {
    const { runs, corrupt } = await listRunLogsInDir('wiki-lookup', 'claude-sonnet-4-6');
    expect(corrupt).toEqual([]);
    expect(runs.map((r) => r.log.timestamp)).toEqual(['2026-05-13T00:00:00Z', '2026-05-12T00:00:00Z']);
  });

  it('returns empty for a directory that does not exist', async () => {
    const { runs, corrupt } = await listRunLogsInDir('nonexistent', 'claude-sonnet-4-6');
    expect(runs).toEqual([]);
    expect(corrupt).toEqual([]);
  });
});
