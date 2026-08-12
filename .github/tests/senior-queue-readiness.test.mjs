// Readiness truth table for senior-queue.yml's two decision rules.
//
// WHY THIS EXISTS. Both rules fail in the direction nothing complains about. A
// PR that should be queued and is not looks exactly like a PR nobody has
// approved yet — the job is green, the label is simply absent, and the only
// detector is a senior noticing weeks later that their queue is short. Both
// have already failed that way in production: PR #1523 sat out of both queues
// on a `runlogs` check that had been re-run green 18 hours earlier, behind five
// review threads its approver never went back to resolve.
//
// The functions are lifted out of the workflow rather than copied, so the two
// cannot drift.
//
// WHAT IT CANNOT COVER. That a label write lands, or that the self-check filter
// excludes the right runs — both are only observable from a live run. Use the
// `workflow_dispatch` dry run against a real approved PR.
//
// Run: node .github/tests/senior-queue-readiness.test.mjs
import fs from 'node:fs';

const WORKFLOW = '.github/workflows/senior-queue.yml';

// Pull the `script: |` block scalar out of the raw YAML and dedent it.
function scriptBody(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex(l => /^\s*script: \|\s*$/.test(l));
  if (start === -1) throw new Error(`${path}: no "script: |" block found`);
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)[0].length <= indent) break;
    out.push(line.slice(indent + 2));
  }
  return out.join('\n');
}

const body = scriptBody(WORKFLOW);
const grab = (re, label) => {
  const m = body.match(re);
  if (!m) {
    throw new Error(
      `could not extract ${label} from ${WORKFLOW} — it was renamed or reformatted. ` +
      `Update this regex, and re-check that this file still tests the real rule.`);
  }
  return m[0];
};

// scriptBody() dedents to column 0, so a top-level `}` in column 0 ends a function.
const newestSrc = grab(/^function newestPerName\(runs\) \{[\s\S]*?\n\}/m, 'newestPerName');
const supersededSrc = grab(/^function supersededThreads\(threads, approvals\) \{[\s\S]*?\n\}/m,
  'supersededThreads');

const { newestPerName, supersededThreads } = new Function(
  `${newestSrc}\n${supersededSrc}\nreturn { newestPerName, supersededThreads };`)();

let failures = 0;
const fail = msg => { failures++; console.error(`FAIL  ${msg}`); };
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) fail(`${label}\n        got  ${g}\n        want ${w}`);
};

// ---------------------------------------------------------------------------
// 1. newestPerName: one run per check name, newest wins.
// ---------------------------------------------------------------------------
const run = (name, conclusion, completed_at, extra = {}) =>
  ({ name, status: 'completed', conclusion, completed_at, started_at: completed_at, ...extra });

const NEWEST = [
  {
    label: 'a failure re-run green on the same sha no longer reads as failing (PR #1523)',
    runs: [
      run('runlogs', 'failure', '2026-08-10T16:05:01Z'),
      run('runlogs', 'success', '2026-08-11T09:56:08Z'),
      run('vitest', 'success', '2026-08-10T16:10:00Z'),
    ],
    want: [['runlogs', 'success'], ['vitest', 'success']],
  },
  {
    label: 'the reverse — green then red — still reads as failing',
    runs: [
      run('runlogs', 'success', '2026-08-10T16:05:01Z'),
      run('runlogs', 'failure', '2026-08-11T09:56:08Z'),
    ],
    want: [['runlogs', 'failure']],
  },
  {
    label: 'a re-run still in progress supersedes the completed attempt it replaces',
    runs: [
      run('vitest', 'failure', '2026-08-10T16:05:01Z'),
      { name: 'vitest', status: 'in_progress', conclusion: null,
        completed_at: null, started_at: '2026-08-11T09:00:00Z' },
    ],
    want: [['vitest', null]],
  },
  {
    label: 'a run with no timestamps at all never displaces a timestamped one',
    runs: [
      run('pytest', 'success', '2026-08-11T09:56:08Z'),
      { name: 'pytest', status: 'completed', conclusion: 'failure',
        completed_at: null, started_at: null },
    ],
    want: [['pytest', 'success']],
  },
  { label: 'no runs', runs: [], want: [] },
];
for (const { label, runs, want } of NEWEST) {
  const got = newestPerName(runs)
    .map(c => [c.name, c.conclusion])
    .sort((a, b) => a[0].localeCompare(b[0]));
  eq(got, want, `newestPerName: ${label}`);
}

// A single-element input must come back untouched, object identity included —
// the dedupe must never rebuild or reorder what it keeps.
const only = run('solo', 'success', '2026-08-11T00:00:00Z');
if (newestPerName([only])[0] !== only) fail('newestPerName: rewrapped a lone check run');

// ---------------------------------------------------------------------------
// 2. supersededThreads: an approval closes its own author's earlier threads.
// ---------------------------------------------------------------------------
const T = (id, opener, times, opts = {}) => ({
  id,
  isResolved: opts.isResolved ?? false,
  comments: {
    pageInfo: { hasNextPage: opts.hasNextPage ?? false },
    nodes: times.map(([login, createdAt]) =>
      login === null ? { createdAt, author: null } : { createdAt, author: { login } }),
  },
  // `opener` is documentation for the reader; the rule reads comments[0].
  opener,
});

const APPROVED_1700 = new Map([['chris', '2026-08-10T17:00:00Z']]);

const SUPERSEDED = [
  {
    label: 'approval after the reviewer\'s only comment closes the thread (PR #1523)',
    threads: [T('t1', 'chris', [['chris', '2026-08-10T12:43:00Z']])],
    approvals: APPROVED_1700,
    want: ['t1'],
  },
  {
    label: 'approval BEFORE the reviewer\'s last comment leaves it open',
    threads: [T('t1', 'chris', [
      ['chris', '2026-08-10T12:43:00Z'],
      ['chris', '2026-08-10T18:00:00Z'],
    ])],
    approvals: APPROVED_1700,
    want: [],
  },
  {
    label: 'the author replying after the approval does not reopen it',
    threads: [T('t1', 'chris', [
      ['chris', '2026-08-10T12:43:00Z'],
      ['florence', '2026-08-10T19:00:00Z'],
    ])],
    approvals: APPROVED_1700,
    want: ['t1'],
  },
  {
    label: 'a thread opened by someone who has not approved keeps blocking',
    threads: [T('t1', 'dallan', [['dallan', '2026-08-10T12:43:00Z']])],
    approvals: APPROVED_1700,
    want: [],
  },
  {
    label: 'one reviewer\'s approval does not close another reviewer\'s thread',
    threads: [
      T('t1', 'chris', [['chris', '2026-08-10T12:00:00Z']]),
      T('t2', 'dallan', [['dallan', '2026-08-10T12:00:00Z'], ['chris', '2026-08-10T12:30:00Z']]),
    ],
    approvals: APPROVED_1700,
    want: ['t1'],
  },
  {
    label: 'a reviewer whose latest standing is changes-requested closes nothing',
    threads: [T('t1', 'chris', [['chris', '2026-08-10T12:43:00Z']])],
    approvals: new Map(),   // evaluate() admits APPROVED standings only
    want: [],
  },
  {
    label: 'an already-resolved thread is not re-resolved',
    threads: [T('t1', 'chris', [['chris', '2026-08-10T12:43:00Z']], { isResolved: true })],
    approvals: APPROVED_1700,
    want: [],
  },
  {
    label: 'an unwalked comment page could hide a later reply, so leave it blocking',
    threads: [T('t1', 'chris', [['chris', '2026-08-10T12:43:00Z']], { hasNextPage: true })],
    approvals: APPROVED_1700,
    want: [],
  },
  {
    label: 'a deleted-account opener (author null) is not treated as an approver',
    threads: [T('t1', null, [[null, '2026-08-10T12:43:00Z']])],
    approvals: APPROVED_1700,
    want: [],
  },
  {
    label: 'an empty thread is skipped rather than crashing',
    threads: [T('t1', 'chris', [])],
    approvals: APPROVED_1700,
    want: [],
  },
];
for (const { label, threads, approvals, want } of SUPERSEDED) {
  eq(supersededThreads(threads, approvals), want, `supersededThreads: ${label}`);
}

if (!failures) {
  console.log(`ok    ${NEWEST.length + 1} newestPerName assertions`);
  console.log(`ok    ${SUPERSEDED.length} supersededThreads assertions`);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
