/**
 * Resolves `eval/` paths from inside the Next.js app.
 *
 * The app lives at `<repo>/eval/app/`. Whether started via
 * `eval/Start.bat`, `npm run dev` from `eval/app/`, or via test
 * runner, `process.cwd()` differs — so we anchor on a stable
 * relative location.
 */
import path from 'node:path';
import fs from 'node:fs';

/**
 * Returns the absolute path to the `eval/` directory.
 *
 * `EVAL_DIR` env var overrides the resolved location — used by
 * Vitest tests so they can point at a temp fixture tree.
 */
export function evalDir(): string {
  if (process.env.EVAL_DIR) {
    return path.resolve(process.env.EVAL_DIR);
  }
  // process.cwd() is `<repo>/eval/app/` when run via `npm run dev`.
  // Walk up until we see a directory named `eval` that contains
  // `tests/` and `fixtures/`.
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (path.basename(dir) === 'eval' && fs.existsSync(path.join(dir, 'tests')) && fs.existsSync(path.join(dir, 'fixtures'))) {
      return dir;
    }
    const candidate = path.join(dir, 'eval');
    if (fs.existsSync(path.join(candidate, 'tests')) && fs.existsSync(path.join(candidate, 'fixtures'))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the eval/ directory from cwd=${process.cwd()}. ` +
      `Set EVAL_DIR to the absolute path of your repo's eval/ directory.`,
  );
}

export function repoRoot(): string {
  return path.dirname(evalDir());
}

export function pluginSkillsDir(): string {
  return path.join(repoRoot(), 'packages', 'engine', 'plugin', 'skills');
}

export function testsUnitDir(): string {
  return path.join(evalDir(), 'tests', 'unit');
}

export function testsE2eDir(): string {
  return path.join(evalDir(), 'tests', 'e2e');
}

export function scenariosDir(): string {
  return path.join(evalDir(), 'fixtures', 'scenarios');
}

export function fixturesDir(): string {
  return path.join(evalDir(), 'fixtures', 'mcp');
}

export function runlogsUnitDir(): string {
  return path.join(evalDir(), 'runlogs', 'unit');
}

export function appLocalDir(): string {
  return path.join(evalDir(), 'app', '.local');
}
