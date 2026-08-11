// Review routing truth table for .github/CODEOWNERS.
//
// WHY THIS EXISTS. CODEOWNERS routes every path to a reviewing team, and a path
// nobody named still routes somewhere: it falls to the `*` catch-all and lands
// on senior genealogists. That is invisible from the file — you have to resolve
// a real path against every rule to see it. It went unnoticed until a Windows
// batch-file PR and a pyproject PR both asked genealogists to review build
// tooling.
//
// THE INVARIANT. No tracked file may be owned by the `*` catch-all alone. Every
// path must be claimed by a rule that names it, so a new file type forces a
// deliberate routing decision at the moment it is added instead of silently
// inheriting the default. The catch-all stays as a floor — a repo with no owner
// for some path is worse — but nothing may rest on it.
//
// It also resolves paths through senior-queue.yml's OWN CODEOWNERS parser,
// which understands only three pattern shapes and skips the rest with a
// warning. A pattern GitHub honours but that parser cannot read enforces the
// merge correctly while routing the review queue to the wrong team, and the
// only signal is a warning nobody reads.
//
// WHAT IT CANNOT COVER. That the named teams exist. A rule naming a nonexistent
// team is silently dropped by GitHub and this file cannot see it — check
// `gh api /repos/{owner}/{repo}/codeowners/errors` after editing CODEOWNERS.
//
// Run: node .github/tests/codeowners-routing.test.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

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

// The two pure functions the workflow uses to route a PR, lifted verbatim so
// this test fails when they drift rather than testing a copy of them.
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

// 2. The `*` catch-all must own nothing.
const catchAll = rules.find(r => r.pattern === '*');
if (!catchAll) fail(`${CODEOWNERS} has no \`*\` rule — every unclaimed path would be unowned`);

const files = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const unclaimed = files.filter(f => {
  let last = null;
  for (const r of rules) if (r.test(f)) last = r;
  return last === null || last.pattern === '*';
});

if (unclaimed.length) {
  // Group by the shape a fix would take, so the message names the rule to add.
  const groups = new Map();
  for (const f of unclaimed) {
    const base = f.split('/').pop();
    const ext = base.includes('.') && !base.startsWith('.') ? `*${base.slice(base.lastIndexOf('.'))}` : base;
    if (!groups.has(ext)) groups.set(ext, []);
    groups.get(ext).push(f);
  }
  const lines = [...groups].sort((a, b) => b[1].length - a[1].length).map(
    ([k, v]) => `        ${k.padEnd(18)} ${String(v.length).padStart(4)} file(s), e.g. ${v[0]}`);
  fail(`${unclaimed.length} tracked file(s) are owned only by the \`*\` catch-all, so they\n` +
       `      route to senior genealogists by default rather than by decision:\n` +
       lines.join('\n') + `\n` +
       `      Add a rule naming each — to senior-developers if it is infrastructure, or\n` +
       `      to senior-genealogists to state that the default is intended.`);
} else {
  console.log(`ok    all ${files.length} tracked files are claimed by an explicit rule`);
}

// 3. The routing the two teams actually care about, stated as a table so a
//    reordering that inverts last-match-wins fails here rather than in review.
const D = 'senior-developers', G = 'senior-genealogists';
const TABLE = [
  // Infrastructure — the class this file was written for.
  ['Makefile', D], ['scripts/mcpb.bat', D], ['scripts/test.sh', D],
  ['apps/server/pyproject.toml', D], ['.gitattributes', D], ['deploy/fly.toml', D],
  ['deploy/Dockerfile', D], ['apps/server/sandbox/e2b.Dockerfile', D],
  ['scripts/git-hooks/post-checkout', D], ['apps/web/src/styles.css', D],
  ['packages/engine/mcp-server/src/index.ts', D],
  // Genealogist content that lives in developer-looking files — the carve-outs.
  ['packages/engine/plugin/skills/citation/SKILL.md', G],
  ['packages/engine/plugin/skills/timeline/scripts/build.py', G],
  ['packages/engine/plugin/agents/gps-mentor.md', G],
  ['eval/fixtures/scenarios/x/research.json', G],
  ['eval/tests/e2e/x/fixture.json', G],
  ['eval/runlogs/unit/citation/run.json', G],
  ['docs/specs/research-schema-spec.md', G],
  // ...and the one carve-out from the carve-out.
  ['docs/specs/schemas/research.schema.json', D],
];
for (const [file, want] of TABLE) {
  const got = ownersOf(file, rules);
  if (got.length !== 1 || got[0] !== want) {
    fail(`${file} routes to [${got.join(', ') || 'nobody'}], expected ${want}`);
  }
}
if (!failures) console.log(`ok    ${TABLE.length} routing assertions`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
