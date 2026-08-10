// Routing truth table for project-status-sync.yml.
//
// WHY THIS EXISTS. That workflow decides which column every card on the board
// lands in, and until this file there was nothing between a typo in its branch
// table and a silently mis-sorted board. The failure is invisible by
// construction: a wrong column is still a valid column, the run goes green, and
// the only symptom is a human eventually noticing Done looks wrong. Three
// workflows in this repo have already gone green while doing nothing.
//
// WHAT IT COVERS, AND WHAT IT CANNOT. It extracts the two PURE decision
// functions from the workflow's github-script body and runs them over every
// input combination. It therefore checks the branch table and nothing else — it
// does not and cannot check that the App token can write the board, that the
// column names still exist on the live project, or that this workflow wins its
// race with the built-in "Item closed" automation. Those need a live run; see
// the ORDERING header note in the workflow.
//
// The extraction is deliberately dependency-free (no js-yaml): this runs on a
// bare `node` with no install step. The cost is that it is coupled to the
// workflow's text shape, so it fails loudly with "could not extract" if the
// functions are renamed or reformatted rather than silently testing nothing.
//
// Run: node .github/tests/project-status-sync-routing.test.mjs
import fs from 'node:fs';

const WORKFLOW = '.github/workflows/project-status-sync.yml';

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
      `Update this regex, and re-check that the truth table below still describes the rule.`);
  }
  return m[0];
};

// The columns the real script resolves off the live board, stubbed by name.
const preamble = `
  const DONE={name:'Done'}, NOT_PLANNED={name:'Not planned'}, REVIEW={name:'Review'},
        IN_PROGRESS={name:'In Progress'}, BACKLOG={name:'Backlog'};
  const TERMINAL=[DONE.name,NOT_PLANNED.name];
`;
const terminalForSrc = grab(/const terminalFor =[\s\S]*?: DONE;/, 'terminalFor');
const desiredSrc     = grab(/function desiredStatus\(issue, pr\) \{[\s\S]*?\n\}/, 'desiredStatus');

const { terminalFor, desiredStatus } = new Function(
  `${preamble}${terminalForSrc}\n${desiredSrc}\nreturn { terminalFor, desiredStatus };`)();

let failures = 0;
const check = (got, want, label) => {
  const g = got === null ? 'null' : got.name;
  const ok = g === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} -> ${g}${ok ? '' : `  (want ${want})`}`);
};

console.log('--- terminalFor: a close reason picks a terminal column ---');
check(terminalFor('COMPLETED'),   'Done',        'COMPLETED');
check(terminalFor('NOT_PLANNED'), 'Not planned', 'NOT_PLANNED');
check(terminalFor('DUPLICATE'),   'Not planned', 'DUPLICATE is not delivered work');
check(terminalFor(null),          'Done',        'null must NOT infer abandonment');
check(terminalFor(undefined),     'Done',        'undefined must NOT infer abandonment');

console.log('\n--- desiredStatus: an issue + a PR that links it ---');
const openPr   = { state: 'OPEN',   isDraft: false };
const draftPr  = { state: 'OPEN',   isDraft: true  };
const mergedPr = { state: 'MERGED', isDraft: false };
const open     = { state: 'OPEN',   stateReason: null };
const done     = { state: 'CLOSED', stateReason: 'COMPLETED' };
const dropped  = { state: 'CLOSED', stateReason: 'NOT_PLANNED' };

check(desiredStatus(open,    openPr),   'Review',      'open issue + open PR');
check(desiredStatus(open,    draftPr),  'In Progress', 'open issue + draft PR');
check(desiredStatus(open,    mergedPr), 'null',        'open issue + merged PR (no opinion)');
check(desiredStatus(done,    openPr),   'Done',        'completed issue cited by an open PR');
check(desiredStatus(done,    mergedPr), 'Done',        'completed issue cited by a merged PR');
// The regression this column exists to prevent: a later PR citing an abandoned
// issue must not resurrect it into Done. Same shape as symptom 1, one over.
check(desiredStatus(dropped, openPr),   'Not planned', 'ABANDONED issue cited by an open PR stays put');
check(desiredStatus(dropped, draftPr),  'Not planned', 'abandoned issue cited by a draft PR stays put');
check(desiredStatus(dropped, mergedPr), 'Not planned', 'abandoned issue cited by a merged PR stays put');

console.log(failures ? `\n${failures} FAILING` : '\nall routing cases pass');
process.exit(failures ? 1 : 0);
