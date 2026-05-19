/**
 * Build a self-contained eval/ fixture tree in a temp dir. Used by
 * tests so they never depend on the real repository data.
 *
 * Each test that needs a tree calls `await makeFixtureTree(spec)` and
 * gets back the root path. Set `EVAL_DIR=<root>` so the data layer
 * modules use it.
 *
 * Schema v2 paths: `eval/runlogs/unit/<skill>/<filename>` (no model dir).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface FixtureUnitTest {
  skill: string;
  filename: string;
  body: unknown;
}

export interface FixtureRunLog {
  skill: string;
  filename: string;
  body: unknown;
  /** Optional sibling `.ann.json` payload. */
  annotation?: unknown;
}

export interface FixtureScenario {
  name: string;
  readme?: string;
  research?: unknown;
  tree?: unknown;
}

export interface FixtureFixture {
  name: string;
  body: unknown;
}

export interface FixtureSkill {
  name: string;
  skillMd?: string;
  rubricMd?: string;
}

export interface FixtureTreeSpec {
  tests?: FixtureUnitTest[];
  corruptTests?: Array<{ skill: string; filename: string; body: string }>;
  runlogs?: FixtureRunLog[];
  corruptRunlogs?: Array<{ skill: string; filename: string; body: string }>;
  scenarios?: FixtureScenario[];
  fixtures?: FixtureFixture[];
  skills?: FixtureSkill[];
  /** Optional eval/harness/judge/prompt.md content. */
  judgePrompt?: string;
}

export interface FixtureTreeHandle {
  root: string;
  /** Absolute repo root (parent of `root`). Useful for snapshot diffs. */
  repoRoot: string;
  cleanup: () => Promise<void>;
}

async function writeJson(p: string, body: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(body, null, 2));
}

async function writeText(p: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

export async function makeFixtureTree(spec: FixtureTreeSpec): Promise<FixtureTreeHandle> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-fixture-'));

  await fs.mkdir(path.join(repoRoot, 'eval', 'tests', 'unit'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'eval', 'fixtures', 'scenarios'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'eval', 'fixtures', 'mcp'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'eval', 'runlogs', 'unit'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'eval', 'harness', 'judge'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'plugin', 'skills'), { recursive: true });

  for (const t of spec.tests ?? []) {
    await writeJson(path.join(repoRoot, 'eval', 'tests', 'unit', t.skill, t.filename), t.body);
  }
  for (const t of spec.corruptTests ?? []) {
    await writeText(path.join(repoRoot, 'eval', 'tests', 'unit', t.skill, t.filename), t.body);
  }
  for (const r of spec.runlogs ?? []) {
    const filePath = path.join(repoRoot, 'eval', 'runlogs', 'unit', r.skill, r.filename);
    await writeJson(filePath, r.body);
    if (r.annotation !== undefined) {
      const annPath = filePath.replace(/\.json$/, '.ann.json');
      await writeJson(annPath, r.annotation);
    }
  }
  for (const r of spec.corruptRunlogs ?? []) {
    await writeText(path.join(repoRoot, 'eval', 'runlogs', 'unit', r.skill, r.filename), r.body);
  }
  for (const s of spec.scenarios ?? []) {
    const dir = path.join(repoRoot, 'eval', 'fixtures', 'scenarios', s.name);
    if (s.readme !== undefined) await writeText(path.join(dir, 'README.md'), s.readme);
    if (s.research !== undefined) await writeJson(path.join(dir, 'research.json'), s.research);
    if (s.tree !== undefined) await writeJson(path.join(dir, 'tree.gedcomx.json'), s.tree);
    await fs.mkdir(dir, { recursive: true });
  }
  for (const f of spec.fixtures ?? []) {
    await writeJson(path.join(repoRoot, 'eval', 'fixtures', 'mcp', `${f.name}.json`), f.body);
  }
  for (const s of spec.skills ?? []) {
    const dir = path.join(repoRoot, 'plugin', 'skills', s.name);
    if (s.skillMd !== undefined) await writeText(path.join(dir, 'SKILL.md'), s.skillMd);
    if (s.rubricMd !== undefined) {
      await writeText(path.join(repoRoot, 'eval', 'tests', 'unit', s.name, 'rubric.md'), s.rubricMd);
    }
    await fs.mkdir(dir, { recursive: true });
  }
  if (spec.judgePrompt !== undefined) {
    await writeText(path.join(repoRoot, 'eval', 'harness', 'judge', 'prompt.md'), spec.judgePrompt);
  }

  const cleanup = async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  };
  return { root: path.join(repoRoot, 'eval'), repoRoot, cleanup };
}

/**
 * Build a minimal multi-test run log envelope (schema v2) for tests.
 */
export function buildRunLog(opts: {
  skill: string;
  version: number | null;
  released?: boolean;
  releasable?: boolean;
  invocation?: 'skill' | 'test' | 'all' | 'tag';
  timestamp: string;
  model?: string;
  judgePromptHash?: string;
  snapshot?: Record<string, string>;
  tests?: Array<{
    test_id: string;
    outcome?: 'pass' | 'partial' | 'fail' | 'aborted' | 'xfail' | 'xpass';
    dimensions?: Array<{
      source: 'base' | 'rubric';
      name: string;
      score: 1 | 2 | 3;
      rationale?: string;
    }>;
  }>;
}): Record<string, unknown> {
  const tests = (opts.tests ?? [{ test_id: 'ut_001' }]).map((t) => {
    const dims = t.dimensions ?? [
      { source: 'base' as const, name: 'Correctness', score: 3 as 1 | 2 | 3 },
      { source: 'base' as const, name: 'Completeness', score: 3 as 1 | 2 | 3 },
      { source: 'rubric' as const, name: 'A', score: 3 as 1 | 2 | 3 },
    ];
    return {
      test_id: t.test_id,
      test_type: 'positive' as const,
      expected_outcome: 'pass' as const,
      scenario: null,
      mcp_fixtures: [],
      outcome: t.outcome ?? 'pass',
      flaky: false,
      outcome_summary: {
        per_run_outcomes: [t.outcome ?? 'pass'],
        aggregated_dimensions: dims.map((d) => ({ rationale: '', ...d })),
      },
      totals: {
        duration_ms: 1000,
        input_tokens: 100,
        cached_input_tokens: 50,
        output_tokens: 20,
        judge_input_tokens: 0,
        judge_cached_input_tokens: 0,
        judge_output_tokens: 0,
        skill_cost_usd: 0.01,
        judge_cost_usd: 0.001,
        total_cost_usd: 0.011,
      },
      runs: [
        {
          run_index: 0,
          run_id: `run_${t.test_id}_0`,
          outcome: t.outcome ?? 'pass',
          aborted_reason: null,
          duration_ms: 1000,
          input_tokens: 100,
          cached_input_tokens: 50,
          output_tokens: 20,
          skill_cost_usd: 0.01,
          output: {
            text_response: '',
            activated: true,
            skills_invoked: [],
            tool_calls: [],
            files_created: [],
          },
          validators: { passed: true, results: [] },
          judge: {
            skipped: false,
            dimensions: dims,
            judge_cost_usd: 0.001,
            error: null,
          },
        },
      ],
    };
  });
  return {
    schema_version: 2,
    skill: opts.skill,
    version: opts.version,
    released: opts.released ?? false,
    releasable: opts.releasable ?? true,
    invocation: opts.invocation ?? 'skill',
    timestamp: opts.timestamp,
    harness_version: '0.2.0',
    model: opts.model ?? 'claude-sonnet-4-6',
    judge_prompt_hash: opts.judgePromptHash ?? 'b'.repeat(64),
    snapshot: opts.snapshot ?? {},
    tests,
    totals: {
      duration_ms: 1000,
      input_tokens: 100,
      cached_input_tokens: 50,
      output_tokens: 20,
      judge_input_tokens: 0,
      judge_cached_input_tokens: 0,
      judge_output_tokens: 0,
      skill_cost_usd: 0.01,
      judge_cost_usd: 0.001,
      total_cost_usd: 0.011,
    },
  };
}
