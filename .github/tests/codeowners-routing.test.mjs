// Review routing truth table for .github/CODEOWNERS.
//
// WHY THIS EXISTS. senior-queue.yml resolves CODEOWNERS itself to decide which
// senior team's queue a PR lands in, and its parser understands only a few
// pattern shapes — anything else it drops with a warning nobody reads. A
// pattern GitHub honours but that parser cannot read enforces the merge
// correctly while routing the review to the wrong team, with no visible
// symptom. This file resolves paths through that same parser, lifted out of the
// workflow rather than copied, so the two cannot drift.
//
// WHAT IT CANNOT COVER. That the named teams exist. A rule naming a nonexistent
// team is silently dropped by GitHub and this file cannot see it — check
// `gh api /repos/{owner}/{repo}/codeowners/errors` after editing CODEOWNERS.
//
// Run: node .github/tests/codeowners-routing.test.mjs
import fs from 'node:fs';

const CODEOWNERS = '.github/CODEOWNERS';
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
      `Update this regex, and re-check that this file still tests the real parser.`);
  }
  return m[0];
};

// scriptBody() dedents to column 0, so a top-level `}` in column 0 ends a function.
const loadSrc = grab(/async function loadCodeowners\(\) \{[\s\S]*?\n\}/, 'loadCodeowners');
const ownersSrc = grab(/^function ownersOf\(file, rules\) \{[\s\S]*?\n\}/m, 'ownersOf');

// loadCodeowners() reads the default branch over the API; here it reads disk.
const stubGithub = `
  const github = { rest: {
    repos: {
      get: async () => ({ data: { default_branch: 'main' } }),
      getContent: async () => ({ data: {
        content: Buffer.from(require('fs').readFileSync(${JSON.stringify(CODEOWNERS)}, 'utf8')).toString('base64'),
      } }),
    },
  } };
  const owner = 'o', repo = 'r';
`;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const { loadCodeowners, ownersOf } = await new AsyncFunction('require',
  `${stubGithub}${loadSrc}\n${ownersSrc}\nreturn { loadCodeowners, ownersOf };`)(
  (await import('node:module')).createRequire(import.meta.url));

const { rules, unknown } = await loadCodeowners();

let failures = 0;
const fail = msg => { failures++; console.error(`FAIL  ${msg}`); };

// 1. Every pattern must be one senior-queue.yml can resolve.
if (unknown.length) {
  fail(`${CODEOWNERS} patterns senior-queue.yml cannot match, so it routes those ` +
       `paths to the wrong review queue: ${unknown.join(', ')}\n` +
       `      Teach loadCodeowners() the shape rather than dropping the pattern.`);
} else {
  console.log(`ok    all ${rules.length} CODEOWNERS rules are shapes senior-queue.yml can resolve`);
}

// 2. Who reviews what, stated as a table so a reordering that inverts
//    last-match-wins fails here rather than in review. `null` means no senior
//    team is required — the two ordinary approvals still are.
const D = 'senior-developers', G = 'senior-genealogists';
const TABLE = [
  // Code and the infra that breaks silently.
  ['packages/engine/mcp-server/src/index.ts', D],
  ['apps/server/app/main.py', D],
  ['apps/server/pyproject.toml', D],
  ['.github/workflows/js-tests.yml', D],
  ['scripts/windows/test-all.bat', D],
  ['Makefile', D],
  ['apps/electron/Makefile', D],
  ['.gitattributes', D],
  ['docs/specs/schemas/research.schema.json', D],
  // Genealogist content, including where it lives in developer-looking files.
  ['packages/engine/plugin/skills/citation/SKILL.md', G],
  ['packages/engine/plugin/skills/timeline/scripts/build.py', G],
  ['packages/engine/plugin/agents/gps-mentor.md', G],
  ['eval/fixtures/scenarios/x/research.json', G],
  ['eval/tests/e2e/x/fixture.json', G],
  ['eval/runlogs/unit/citation/run.json', G],
  // Documentation and incidental files need no senior. Losing these to a team
  // is the regression this table is here to catch.
  ['README.md', null],
  ['docs/architecture.md', null],
  ['docs/specs/research-schema-spec.md', null],
  ['.claude/skills/fill-ready/SKILL.md', null],
  ['apps/web/src/styles.css', null],
  ['apps/web/public/favicon.svg', null],
  ['.gitignore', null],
  ['scripts/test.sh', null],
];
for (const [file, want] of TABLE) {
  const got = ownersOf(file, rules);
  const ok = want === null ? got.length === 0 : got.length === 1 && got[0] === want;
  if (!ok) fail(`${file} routes to [${got.join(', ') || 'no senior team'}], expected ${want ?? 'no senior team'}`);
}
if (!failures) console.log(`ok    ${TABLE.length} routing assertions`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
