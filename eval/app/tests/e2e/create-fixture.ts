import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_FILE = path.join(os.tmpdir(), 'pw-eval-fixture-state.json');

export const SKILL = 'layout-check';
export const RUN_LOG_FILE = 'v1_2025-01-01_00-00-00.json';

const LONG_UNBROKEN_TOKEN = 'Abcdefghij'.repeat(60);

function buildMinimalRunLog() {
  const dims = [
    { source: 'base', name: 'Correctness', score: 3, rationale: 'Correct answer provided.' },
    { source: 'base', name: 'Completeness', score: 2, rationale: 'Partially complete response.' },
    { source: 'base', name: 'Tool Arguments', score: 3, rationale: 'Arguments well-formed.' },
    { source: 'rubric', name: 'Overflow', score: 3, rationale: LONG_UNBROKEN_TOKEN },
  ];
  const testEntry = {
    test_id: 'ut_geom_001',
    test_type: 'positive',
    expected_outcome: 'pass',
    scenario: null,
    mcp_fixtures: [],
    outcome: 'pass',
    flaky: false,
    outcome_summary: {
      per_run_outcomes: ['pass'],
      aggregated_dimensions: dims.map((d) => ({ ...d, rationale: d.rationale ?? '' })),
    },
    totals: {
      duration_ms: 1000, input_tokens: 100, cached_input_tokens: 50,
      output_tokens: 20, judge_input_tokens: 0, judge_cached_input_tokens: 0,
      judge_output_tokens: 0, skill_cost_usd: 0.01, judge_cost_usd: 0.001,
      total_cost_usd: 0.011,
    },
    runs: [{
      run_index: 0, run_id: 'run_ut_geom_001_0', outcome: 'pass',
      aborted_reason: null, duration_ms: 1000, input_tokens: 100,
      cached_input_tokens: 50, output_tokens: 20, skill_cost_usd: 0.01,
      output: { text_response: '', activated: true, skills_invoked: [], tool_calls: [], files_created: [] },
      validators: { passed: true, results: [] },
      judge: { skipped: false, dimensions: dims, judge_cost_usd: 0.001, error: null },
    }],
  };
  return {
    schema_version: 3, skill: SKILL, version: 1, released: false,
    releasable: true, invocation: 'skill',
    timestamp: '2025-01-01T00:00:00Z', harness_version: '0.2.0',
    model: 'claude-sonnet-4-6', judge_prompt_hash: 'b'.repeat(64),
    snapshot: {}, tests: [testEntry],
    totals: {
      duration_ms: 1000, input_tokens: 100, cached_input_tokens: 50,
      output_tokens: 20, judge_input_tokens: 0, judge_cached_input_tokens: 0,
      judge_output_tokens: 0, skill_cost_usd: 0.01, judge_cost_usd: 0.001,
      total_cost_usd: 0.011,
    },
  };
}

export function createFixtureSync(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-fixture-'));
  const root = path.join(repoRoot, 'eval');

  for (const dir of [
    path.join(root, 'tests', 'unit'),
    path.join(root, 'fixtures', 'scenarios'),
    path.join(root, 'fixtures', 'mcp'),
    path.join(root, 'runlogs', 'unit', SKILL),
    path.join(root, 'harness', 'judge'),
    path.join(repoRoot, 'packages', 'engine', 'plugin', 'skills', SKILL),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(repoRoot, 'packages', 'engine', 'plugin', 'skills', SKILL, 'SKILL.md'),
    '---\nname: layout-check\n---\nA fixture skill for geometry tests.\n',
  );
  fs.writeFileSync(
    path.join(root, 'runlogs', 'unit', SKILL, RUN_LOG_FILE),
    JSON.stringify(buildMinimalRunLog(), null, 2),
  );

  fs.writeFileSync(STATE_FILE, JSON.stringify({ repoRoot }));
  return root;
}

export function cleanupFixture(): void {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    fs.rmSync(state.repoRoot, { recursive: true, force: true });
    fs.unlinkSync(STATE_FILE);
  } catch {
    // best-effort
  }
}
