/**
 * Read/write/list unit-test JSON files under `eval/tests/unit/<skill>/`.
 *
 * Validation policy: shape, not reference existence. A test whose
 * scenario was renamed must still save so the junior can fix it. The
 * `blocked` indicator is computed separately from existence checks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { testsUnitDir, scenariosDir, fixturesDir } from '../paths';
import type { BlockedReason, UnitTestFile, UnitTestListEntry } from '../types';
import { atomicWriteJson } from './atomic';

/** Result of a `listTests` call — separates clean rows from corrupt ones. */
export interface ListTestsResult {
  tests: UnitTestListEntry[];
  corrupt: string[];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function computeBlockedReason(
  test: UnitTestFile,
): Promise<BlockedReason | null> {
  const scenario = test.input.scenario ?? null;
  if (test.input.scenario_notes && test.input.scenario_notes.trim() !== '') {
    return { kind: 'scenario-notes-present', notes: test.input.scenario_notes };
  }
  if (scenario) {
    const scenarioPath = path.join(scenariosDir(), scenario);
    if (!(await exists(scenarioPath))) {
      return { kind: 'missing-scenario', scenario };
    }
  }
  for (const fix of test.mcp_fixtures ?? []) {
    const fixPath = path.join(fixturesDir(), `${fix}.json`);
    if (!(await exists(fixPath))) {
      return { kind: 'missing-fixture', fixture: fix };
    }
  }
  return null;
}

function toListEntry(test: UnitTestFile, filePath: string, blocked: BlockedReason | null): UnitTestListEntry {
  return {
    id: test.test.id,
    skill: test.test.skill,
    name: test.test.name,
    type: test.test.type,
    description: test.test.description,
    tags: test.test.tags,
    holdout: test.test.holdout ?? false,
    scenario: test.input.scenario ?? null,
    mcpFixtures: test.mcp_fixtures ?? [],
    filePath,
    blocked,
  };
}

export async function listTests(): Promise<ListTestsResult> {
  const root = testsUnitDir();
  const tests: UnitTestListEntry[] = [];
  const corrupt: string[] = [];

  let skillDirs: string[];
  try {
    skillDirs = await fs.readdir(root);
  } catch {
    return { tests: [], corrupt: [] };
  }

  for (const skill of skillDirs) {
    const skillPath = path.join(root, skill);
    let stat;
    try {
      stat = await fs.stat(skillPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[];
    try {
      files = await fs.readdir(skillPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(skillPath, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as UnitTestFile;
        if (!parsed?.test?.id) throw new Error('missing test.id');
        const blocked = await computeBlockedReason(parsed);
        tests.push(toListEntry(parsed, filePath, blocked));
      } catch (err) {
        console.warn(`[tests.ts] could not read ${filePath}: ${(err as Error).message}`);
        corrupt.push(filePath);
      }
    }
  }

  tests.sort((a, b) => a.skill.localeCompare(b.skill) || a.name.localeCompare(b.name));
  return { tests, corrupt };
}

export async function readTest(id: string): Promise<{ test: UnitTestFile; filePath: string } | null> {
  const root = testsUnitDir();
  let skillDirs: string[];
  try {
    skillDirs = await fs.readdir(root);
  } catch {
    return null;
  }
  for (const skill of skillDirs) {
    const skillPath = path.join(root, skill);
    let files: string[];
    try {
      files = await fs.readdir(skillPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(skillPath, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as UnitTestFile;
        if (parsed?.test?.id === id) {
          return { test: parsed, filePath };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Write a unit test. The location is derived from `test.skill` — the
 * file lives under `eval/tests/unit/<skill>/<id>.json`. If a file with
 * the same id exists under a different skill (rare — typically only
 * possible after a manual rename), we don't try to relocate it; the
 * caller is responsible for deletes.
 */
export async function writeTest(test: UnitTestFile): Promise<string> {
  const filePath = path.join(testsUnitDir(), test.test.skill, `${test.test.id}.json`);
  await atomicWriteJson(filePath, test);
  return filePath;
}

export async function deleteTest(id: string): Promise<boolean> {
  const found = await readTest(id);
  if (!found) return false;
  await fs.unlink(found.filePath);
  return true;
}

/**
 * Returns the next free test id for a given skill, in the form
 * `ut_<skill_with_underscores>_<NNN>`. Looks at existing tests to
 * avoid collisions.
 */
export async function nextTestId(skill: string): Promise<string> {
  // Default prefix derived from the skill directory name. Used only when the
  // skill has no existing tests — otherwise we continue whatever prefix the
  // corpus already uses, which can diverge from the directory name after a
  // skill rename (e.g. dir `search-familysearch-wiki`, ids `ut_search_wiki_*`).
  const fallbackPrefix = `ut_${skill.replace(/-/g, '_')}_`;

  const root = testsUnitDir();
  const skillPath = path.join(root, skill);
  let files: string[] = [];
  try {
    files = await fs.readdir(skillPath);
  } catch {
    files = [];
  }

  // Continue the prefix the existing ids use (ids within a skill dir are
  // homogeneous), tracking the highest sequence number. Fall back to the
  // dir-derived prefix only when the skill has no tests yet.
  let prefix = fallbackPrefix;
  let max = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(skillPath, file), 'utf8');
      const parsed = JSON.parse(raw) as UnitTestFile;
      const m = (parsed?.test?.id ?? '').match(/^(ut_.+_)(\d+)$/);
      if (!m) continue;
      prefix = m[1];
      const n = parseInt(m[2], 10);
      if (n > max) max = n;
    } catch {
      continue;
    }
  }

  const next = String(max + 1).padStart(3, '0');
  return `${prefix}${next}`;
}

/**
 * Fields whose change invalidates the content hash (per spec §3 and
 * plan §2.4). Used by the edit form to decide whether to show the
 * "content-changed" warning.
 *
 * `test.holdout` is included because the snapshot normalization strips
 * only the cosmetic `test.{name,description,tags}` — holdout survives
 * into the snapshot, so flipping it changes the content hash and flips
 * the active run log inactive (forces a re-run), even though it never
 * changes grading. (It governs only the skill-improver's behavior; see
 * docs/skill-lifecycle.md.)
 */
export const GRADING_RELEVANT_FIELDS = [
  'input.user_message',
  'input.scenario',
  'mcp_fixtures',
  'judge_context',
  'negative',
  'test.holdout',
] as const;

/** True if any grading-relevant field differs between `before` and `after`. */
export function hasGradingRelevantChange(before: UnitTestFile, after: UnitTestFile): boolean {
  if (before.input.user_message !== after.input.user_message) return true;
  if ((before.input.scenario ?? null) !== (after.input.scenario ?? null)) return true;
  if (JSON.stringify(before.mcp_fixtures ?? []) !== JSON.stringify(after.mcp_fixtures ?? [])) return true;
  if (JSON.stringify(before.judge_context) !== JSON.stringify(after.judge_context)) return true;
  if (JSON.stringify(before.negative ?? null) !== JSON.stringify(after.negative ?? null)) return true;
  if ((before.test.holdout ?? false) !== (after.test.holdout ?? false)) return true;
  return false;
}
