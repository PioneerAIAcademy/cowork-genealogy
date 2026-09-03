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
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
