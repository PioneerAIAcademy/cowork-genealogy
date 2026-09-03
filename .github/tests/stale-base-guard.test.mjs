// The stale-base guard's watched-file list must be non-empty and every entry
// must exist on disk. A watched path that was deleted/renamed is a stale entry:
// the guard fires on a path the PR can't touch, so it's dead weight.
//
// The truth-table section below tests the guard's two decision functions —
// "which watched files does this PR touch?" and "which of those are contended
// on the base branch?" — over every input combination. The guard must fire
// only when BOTH conditions hold: the PR touches a watched file AND main
// changed that file since the merge-base. Anything else is a silent pass.
//
// Run: node .github/tests/stale-base-guard.test.mjs
import fs from 'node:fs';

const WORKFLOW = '.github/workflows/stale-base-guard.yml';
const text = fs.readFileSync(WORKFLOW, 'utf8');

let failures = 0;
const fail = msg => { failures++; console.error(`FAIL  ${msg}`); };
const check = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

// ---------------------------------------------------------------------------
// Part 1: watched-file hygiene (existing)
// ---------------------------------------------------------------------------
console.log('--- watched-file hygiene ---');

const block = text.match(/WATCHED=\(\s*([\s\S]*?)\)/);
if (!block) {
  fail('could not find WATCHED=( ... ) block in the workflow — renamed?');
} else {
  const entries = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

  if (entries.length === 0) {
    fail('WATCHED list is empty — the guard is a no-op');
  }

  for (const path of entries) {
    if (!fs.existsSync(path)) {
      fail(`watched file "${path}" does not exist on disk — stale entry`);
    }
  }

  if (!failures) {
    console.log(`ok    ${entries.length} watched files, all exist on disk`);
  }
}

// ---------------------------------------------------------------------------
// Part 2: decision truth table
// ---------------------------------------------------------------------------
//
// The workflow has two sequential decisions:
//
//   1. SCOPE: intersect the PR's changed-file list with WATCHED.
//      If the intersection is empty, report success and stop.
//
//   2. CONTENTION: for each file in the intersection, check whether main
//      changed it since the merge-base (`git diff --quiet` exit code).
//      If any file is contended, fail.
//
// We re-implement both as pure JS functions matching the shell logic exactly,
// then run every combination through them.
// ---------------------------------------------------------------------------
console.log('\n--- decision truth table ---');

// Re-implementation of the scope step's loop:
//   for w in WATCHED; if printf '%s\n' "$files" | grep -qxF "$w"; touched += w
function scopeCheck(watched, prFiles) {
  const touched = [];
  for (const w of watched) {
    if (prFiles.includes(w)) touched.push(w);
  }
  return touched;
}

// Re-implementation of the contention step's loop:
//   for file in TOUCHED; if ! git diff --quiet ...; contended += file
// `baseChanged` is a Set of files that changed on the base branch since
// the merge-base (simulating a non-zero exit from `git diff --quiet`).
function contentionCheck(touched, baseChanged) {
  const contended = [];
  for (const file of touched) {
    if (baseChanged.has(file)) contended.push(file);
  }
  return contended;
}

// Combined: returns { pass: bool, contended: string[] }
function guard(watched, prFiles, baseChanged) {
  const touched = scopeCheck(watched, prFiles);
  if (touched.length === 0) return { pass: true, contended: [] };
  const contended = contentionCheck(touched, baseChanged);
  return { pass: contended.length === 0, contended };
}

const W = ['CLAUDE.md', 'Makefile'];            // representative subset
const watchedFile = 'CLAUDE.md';
const unwatchedFile = 'src/tools/foo.ts';

// Row 1: PR does NOT touch a watched file, base did NOT change it.
check(
  guard(W, [unwatchedFile], new Set()),
  { pass: true, contended: [] },
  'PR ignores watched files, base unchanged          -> PASS (skip early)');

// Row 2: PR does NOT touch a watched file, base DID change one.
check(
  guard(W, [unwatchedFile], new Set([watchedFile])),
  { pass: true, contended: [] },
  'PR ignores watched files, base changed one        -> PASS (skip early)');

// Row 3: PR touches a watched file, base did NOT change it.
check(
  guard(W, [watchedFile], new Set()),
  { pass: true, contended: [] },
  'PR touches watched file, base unchanged           -> PASS (no contention)');

// Row 4: PR touches a watched file, base DID change it.
check(
  guard(W, [watchedFile], new Set([watchedFile])),
  { pass: false, contended: [watchedFile] },
  'PR touches watched file, base changed it too      -> FAIL (stale)');

// Edge: PR touches multiple watched files, only one contended.
check(
  guard(W, [watchedFile, 'Makefile'], new Set([watchedFile])),
  { pass: false, contended: [watchedFile] },
  'Two watched files touched, one contended          -> FAIL (partial stale)');

// Edge: PR touches multiple watched files, none contended.
check(
  guard(W, [watchedFile, 'Makefile'], new Set()),
  { pass: true, contended: [] },
  'Two watched files touched, none contended         -> PASS');

// Edge: PR touches multiple watched files, all contended.
check(
  guard(W, [watchedFile, 'Makefile'], new Set([watchedFile, 'Makefile'])),
  { pass: false, contended: [watchedFile, 'Makefile'] },
  'Two watched files touched, both contended         -> FAIL');

// Edge: empty PR file list.
check(
  guard(W, [], new Set()),
  { pass: true, contended: [] },
  'Empty PR file list                                -> PASS (skip early)');

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Part 3: the workflow's ACTUAL shell, driven against a real git repo
// ---------------------------------------------------------------------------
//
// Part 2 above runs a truth table over a JS re-implementation. That documents
// the intent but cannot fail on a change to the workflow, because the workflow
// is not its subject: inverting `git diff --quiet`, breaking the merge-base
// line, or re-adding `--depth=1` all leave Part 2 green (measured). The
// `--depth=1` bug that shipped in this file's first revision is exactly that
// shape — it made `git merge-base` exit 1 with empty output, so `set -e` killed
// the step before any check ran, and every PR touching a watched file went red
// with no message.
//
// So this part extracts the two `run:` blocks from the YAML and executes them
// against a throwaway repo, in both directions. The sibling tests do the same
// thing — `check-runlogs-post-gate-lints.test.mjs` parses the workflow text,
// `codeowners-routing.test.mjs` lifts the real parser — rather than testing a
// copy (#2204 review).
// ---------------------------------------------------------------------------
console.log('\n--- workflow shell, executed ---');

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Pull one step's `run: |` body out of the workflow by its `name:`. */
function stepScript(stepName) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.includes(`- name: ${stepName}`));
  if (start === -1) {
    fail(`step "${stepName}" not found in the workflow — renamed?`);
    return null;
  }
  const runAt = lines.findIndex((l, i) => i > start && /^\s*run: \|/.test(l));
  if (runAt === -1) {
    fail(`step "${stepName}" has no \`run: |\` block`);
    return null;
  }
  const indent = lines[runAt].match(/^\s*/)[0].length + 2;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    if (l.match(/^\s*/)[0].length < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

const fetchStep = stepScript('Fetch base branch ref');
const checkStep = stepScript('Check for stale-base contention');

if (fetchStep && checkStep) {
  const sh = (cwd, script, env = {}) =>
    execFileSync('bash', ['-c', script], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbg-'));
  const origin = path.join(tmp, 'origin');
  const work = path.join(tmp, 'work');

  // A base with one watched file, and a PR branch that edits it.
  sh(tmp, `
    set -e
    git init -q -b main "${origin}"
    cd "${origin}"
    git config user.email t@t && git config user.name t
    printf 'v1\\n' > CLAUDE.md && printf 'x\\n' > other.md
    git add -A && git commit -qm base
    git checkout -qb feature && printf 'pr\\n' >> CLAUDE.md && git commit -qam pr
    git checkout -q main
    git clone -q --no-local "${origin}" "${work}"
    cd "${work}"
    git fetch -q origin '+refs/heads/feature:refs/remotes/origin/feature'
    git checkout -q -B feature origin/feature
  `);

  // GITHUB_OUTPUT is written by the fetch step; give it somewhere to go.
  const ghOut = path.join(tmp, 'gh-output');
  fs.writeFileSync(ghOut, '');
  const env = { BASE_REF: 'main', TOUCHED: 'CLAUDE.md', GITHUB_OUTPUT: ghOut };

  const runGuard = () => {
    try {
      sh(work, fetchStep, env);
      sh(work, checkStep, env);
      return { exit: 0 };
    } catch (e) {
      return { exit: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  // A) main has NOT touched the watched file → the guard must pass.
  const clean = runGuard();
  check(clean.exit, 0, 'clean base: guard exits 0 (a full-history fetch, merge-base resolves)');

  // B) main HAS touched it since the merge-base → the guard must fire.
  sh(origin, `
    set -e
    git config user.email t@t && git config user.name t
    printf 'main\\n' >> CLAUDE.md && git commit -qam 'main edits CLAUDE.md'
  `);
  const stale = runGuard();
  check(stale.exit !== 0, true, 'stale base: guard exits non-zero');
  check(
    /CLAUDE\.md/.test(stale.out ?? ''),
    true,
    'stale base: the failure names the contended file',
  );

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
