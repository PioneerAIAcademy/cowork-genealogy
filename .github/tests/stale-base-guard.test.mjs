// The stale-base guard's watched-file list must be non-empty and every entry
// must exist on disk. A watched path that was deleted/renamed is a stale entry:
// the guard fires on a path the PR can't touch, so it's dead weight.
//
// Run: node .github/tests/stale-base-guard.test.mjs
import fs from 'node:fs';

const WORKFLOW = '.github/workflows/stale-base-guard.yml';
const text = fs.readFileSync(WORKFLOW, 'utf8');

let failures = 0;
const fail = msg => { failures++; console.error(`FAIL  ${msg}`); };

// Extract the WATCHED=( ... ) block from the workflow YAML.
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

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
