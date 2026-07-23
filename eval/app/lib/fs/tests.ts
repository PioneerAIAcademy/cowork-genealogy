/**
 * Read/write/list unit-test JSON files under `eval/tests/unit/<skill>/`.
 *
 * Validation policy: shape, not reference existence. A test whose
 * scenario was renamed must still save so the junior can fix it. The
 * `blocked` indicator is computed separately from existence checks.
 */
import crypto from 'node:crypto';
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
    expectedOutcome: test.test.expected_outcome ?? 'pass',
    xfailReason: test.test.xfail_reason ?? null,
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
 * Write a unit test.
 *
 * An edit writes back to the file it was read from, preserving the
 * author's filename. Only a genuinely new test gets the derived
 * `<skill>/<id>.json` name.
 *
 * This matters because most tests are hand-authored with descriptive
 * names (`different-jurisdiction-ireland.json`), not `<id>.json`. Always
 * deriving the path meant editing one in the UI left the original in
 * place and wrote a *second* file carrying the same `test.id` — and
 * duplicate ids corrupt grading downstream: the harness runs both files,
 * so one run log carries two `tests[]` entries with the same `test_id`,
 * and annotations key on `(test_id, dimension_source, dimension_name)`,
 * so one test's corrections silently become the other's.
 *
 * When the form changes `test.skill`, the file moves to the new skill
 * dir (keeping its basename) and the old one is removed — a move, not a
 * copy, for the same reason.
 */
export async function writeTest(test: UnitTestFile): Promise<string> {
  const existing = await readTest(test.test.id);
  let filePath: string;

  if (!existing) {
    filePath = path.join(testsUnitDir(), test.test.skill, `${test.test.id}.json`);
  } else {
    const targetDir = path.join(testsUnitDir(), test.test.skill);
    filePath = path.join(targetDir, path.basename(existing.filePath));
  }

  await atomicWriteJson(filePath, test);

  if (existing && path.resolve(existing.filePath) !== path.resolve(filePath)) {
    await fs.unlink(existing.filePath).catch(() => {
      // The new file is already written; a failed cleanup of the old one
      // leaves a duplicate id rather than losing the edit. The CI
      // duplicate-id check (check_runlogs.py) is the backstop.
    });
  }

  return filePath;
}

export async function deleteTest(id: string): Promise<boolean> {
  const found = await readTest(id);
  if (!found) return false;
  await fs.unlink(found.filePath);
  return true;
}

/**
 * Alphabet for the random id suffix. Lowercase alphanumerics minus the
 * shapes that get misread when someone retypes an id from a run log into
 * `run_tests.py --test ut_…`: `0`/`o`, `1`/`l`.
 */
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_SUFFIX_LENGTH = 3;

function randomIdSuffix(): string {
  let out = '';
  for (let i = 0; i < ID_SUFFIX_LENGTH; i += 1) {
    out += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)];
  }
  return out;
}

/** Every `test.id` currently in the corpus, across all skills. */
async function collectAllTestIds(): Promise<Set<string>> {
  const { tests } = await listTests();
  return new Set(tests.map((t) => t.id));
}

/**
 * Returns a free test id for a given skill, in the form
 * `ut_<skill_with_underscores>_<xyz>` — a random 3-character suffix, not a
 * sequence number.
 *
 * Sequential numbering (`max(N)+1`) could only ever be unique *within one
 * branch*. Two people adding a test to the same skill on parallel branches
 * both drew the same number and the duplicate appeared at merge, which is
 * how three duplicate-id groups accumulated in a month. A duplicate then
 * corrupts grading silently (see `writeTest`), and neither author could
 * have prevented it or fixed it: the id is assigned here, server-side, and
 * the CRUD UI has no field to change it.
 *
 * A random suffix makes the cross-branch collision a coincidence rather
 * than a certainty — 32^3 ≈ 33k per skill, against corpora of ~20 tests.
 * Collisions *within* a branch are eliminated outright by checking the
 * corpus below. CI rule 4 (`check_runlogs.py`) remains as the backstop for
 * the residual case, where the reader is a developer rather than a
 * genealogist.
 */
export async function nextTestId(skill: string): Promise<string> {
  // Continue whatever prefix the skill's existing ids use — it can diverge
  // from the directory name after a skill rename (dir
  // `search-familysearch-wiki`, ids `ut_search_wiki_*`). Fall back to the
  // dir-derived prefix when the skill has no tests yet. Taking the prefix as
  // "everything up to the last underscore" reads both the legacy numeric ids
  // and the random-suffix ones.
  let prefix = `ut_${skill.replace(/-/g, '_')}_`;

  const skillPath = path.join(testsUnitDir(), skill);
  let files: string[] = [];
  try {
    files = await fs.readdir(skillPath);
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(skillPath, file), 'utf8');
      const parsed = JSON.parse(raw) as UnitTestFile;
      const id = parsed?.test?.id ?? '';
      const m = id.match(/^(ut_.+_)[^_]+$/);
      if (m) prefix = m[1];
    } catch {
      continue;
    }
  }

  const taken = await collectAllTestIds();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}${randomIdSuffix()}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(
    `could not find a free test id for "${skill}" after 50 attempts — ` +
      `the ${ID_SUFFIX_LENGTH}-character suffix space may be exhausted for prefix "${prefix}"`,
  );
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
 * docs/skill-lifecycle.md.) `judge_reads_files` is included for the same
 * reason — it is a real (non-cosmetic) field that survives normalization,
 * and it genuinely changes what the judge sees, so flipping it must
 * invalidate the content hash.
 *
 * `test.expected_outcome` / `test.xfail_reason` are included on the same
 * grounds: they survive normalization, and expected_outcome changes how
 * the harness labels the result (`fail` → `xfail`, `pass` → `xpass`), so
 * a run log recorded under the old marking no longer describes the test.
 * Marking a test xfail therefore forces a re-run — that is correct, not a
 * wrinkle to design around: the re-run is what produces a log that reads
 * `xfail` instead of `fail`.
 */
export const GRADING_RELEVANT_FIELDS = [
  'input.user_message',
  'input.scenario',
  'mcp_fixtures',
  'judge_context',
  'negative',
  'test.holdout',
  'test.expected_outcome',
  'test.xfail_reason',
  'judge_reads_files',
] as const;

/** True if any grading-relevant field differs between `before` and `after`. */
export function hasGradingRelevantChange(before: UnitTestFile, after: UnitTestFile): boolean {
  if (before.input.user_message !== after.input.user_message) return true;
  if ((before.input.scenario ?? null) !== (after.input.scenario ?? null)) return true;
  if (JSON.stringify(before.mcp_fixtures ?? []) !== JSON.stringify(after.mcp_fixtures ?? [])) return true;
  if (JSON.stringify(before.judge_context) !== JSON.stringify(after.judge_context)) return true;
  if (JSON.stringify(before.negative ?? null) !== JSON.stringify(after.negative ?? null)) return true;
  if ((before.test.holdout ?? false) !== (after.test.holdout ?? false)) return true;
  if ((before.test.expected_outcome ?? 'pass') !== (after.test.expected_outcome ?? 'pass')) return true;
  if ((before.test.xfail_reason ?? '') !== (after.test.xfail_reason ?? '')) return true;
  if ((before.judge_reads_files ?? false) !== (after.judge_reads_files ?? false)) return true;
  return false;
}
