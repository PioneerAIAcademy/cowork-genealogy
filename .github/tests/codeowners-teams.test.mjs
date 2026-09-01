// Two rules .github/CODEOWNERS states about itself, neither of which GitHub
// checks. `codeowners/errors` reports unparseable patterns and nonexistent
// teams; a rule that parses fine and names a real team is accepted whatever it
// does to who may merge.
//
// Run: node .github/tests/codeowners-teams.test.mjs
import fs from 'node:fs';

const PATH = '.github/CODEOWNERS';
const SENIORS = ['@PioneerAIAcademy/senior-developers',
                 '@PioneerAIAcademy/senior-genealogists'];

const rules = fs.readFileSync(PATH, 'utf8').split('\n')
  .map(l => l.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map(l => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners }; });

let failures = 0;
const fail = msg => { failures++; console.error(`FAIL  ${msg}`); };

if (!rules.length) fail(`${PATH}: parsed zero rules — the reader is broken, not the file`);

// 1. Every rule names BOTH senior teams. Owners are an OR, so this is what lets
//    a senior of either kind unblock any PR. A line that drops one re-narrows
//    the merge gate to one specific team and nothing downstream says so — the
//    PR just sits at REVIEW_REQUIRED with the "wrong" senior's approval on it.
for (const { pattern, owners } of rules) {
  const missing = SENIORS.filter(t => !owners.includes(t));
  if (missing.length) {
    fail(`${pattern} names [${owners.join(', ')}] — every rule must name both ` +
         `senior teams, missing ${missing.join(', ')}`);
  }
}

// 2. No `*` default. A path nobody claims still needs two approvals; a catch-all
//    would additionally pull a senior into every CSS tweak and dotfile.
for (const { pattern } of rules) {
  if (pattern === '*') fail(`${PATH} has a \`*\` default — there is deliberately none`);
}

if (!failures) console.log(`ok    all ${rules.length} rules name both senior teams, no \`*\` default`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
