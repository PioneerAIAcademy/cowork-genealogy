/**
 * Build a self-contained eval/ fixture tree in a temp dir. Used by
 * tests so they never depend on the real repository data.
 *
 * Each test that needs a tree calls `await makeFixtureTree(spec)` and
 * gets back the root path. Set `EVAL_DIR=<root>` so the data layer
 * modules use it.
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
  model: string;
  filename: string;
  body: unknown;
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
  /** Raw text test files that should fail JSON.parse — for testing corrupt-skipping. */
  corruptTests?: Array<{ skill: string; filename: string; body: string }>;
  runlogs?: FixtureRunLog[];
  corruptRunlogs?: Array<{ skill: string; model: string; filename: string; body: string }>;
  scenarios?: FixtureScenario[];
  fixtures?: FixtureFixture[];
  skills?: FixtureSkill[];
}

export interface FixtureTreeHandle {
  root: string;
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-fixture-'));

  // Required directories (paths.ts walks these to anchor `eval/`).
  await fs.mkdir(path.join(root, 'eval', 'tests', 'unit'), { recursive: true });
  await fs.mkdir(path.join(root, 'eval', 'fixtures', 'scenarios'), { recursive: true });
  await fs.mkdir(path.join(root, 'eval', 'fixtures', 'mcp'), { recursive: true });
  await fs.mkdir(path.join(root, 'eval', 'runlogs', 'unit'), { recursive: true });
  await fs.mkdir(path.join(root, 'plugin', 'skills'), { recursive: true });

  for (const t of spec.tests ?? []) {
    await writeJson(path.join(root, 'eval', 'tests', 'unit', t.skill, t.filename), t.body);
  }
  for (const t of spec.corruptTests ?? []) {
    await writeText(path.join(root, 'eval', 'tests', 'unit', t.skill, t.filename), t.body);
  }
  for (const r of spec.runlogs ?? []) {
    const filePath = path.join(root, 'eval', 'runlogs', 'unit', r.skill, r.model, r.filename);
    await writeJson(filePath, r.body);
    if (r.annotation !== undefined) {
      const annPath = filePath.replace(/\.json$/, '.ann.json');
      await writeJson(annPath, r.annotation);
    }
  }
  for (const r of spec.corruptRunlogs ?? []) {
    await writeText(path.join(root, 'eval', 'runlogs', 'unit', r.skill, r.model, r.filename), r.body);
  }
  for (const s of spec.scenarios ?? []) {
    const dir = path.join(root, 'eval', 'fixtures', 'scenarios', s.name);
    if (s.readme !== undefined) await writeText(path.join(dir, 'README.md'), s.readme);
    if (s.research !== undefined) await writeJson(path.join(dir, 'research.json'), s.research);
    if (s.tree !== undefined) await writeJson(path.join(dir, 'tree.gedcomx.json'), s.tree);
    // Ensure directory exists even if all docs were omitted.
    await fs.mkdir(dir, { recursive: true });
  }
  for (const f of spec.fixtures ?? []) {
    await writeJson(path.join(root, 'eval', 'fixtures', 'mcp', `${f.name}.json`), f.body);
  }
  for (const s of spec.skills ?? []) {
    const dir = path.join(root, 'plugin', 'skills', s.name);
    if (s.skillMd !== undefined) await writeText(path.join(dir, 'SKILL.md'), s.skillMd);
    if (s.rubricMd !== undefined) {
      await writeText(path.join(root, 'eval', 'tests', 'unit', s.name, 'rubric.md'), s.rubricMd);
    }
    await fs.mkdir(dir, { recursive: true });
  }

  const cleanup = async () => {
    await fs.rm(root, { recursive: true, force: true });
  };
  return { root: path.join(root, 'eval'), cleanup };
}
