// Every diagnostic step AFTER the run-log gate in check-runlogs.yml must carry
// `!cancelled()` in its `if:`.
//
// WHY THIS EXISTS. An `if:` with no status-check function carries an implicit
// `success()`, so `if: steps.scope.outputs.relevant == 'true'` on a step after
// the gate is really `success() && ...` — when the gate `Run runlog discipline
// checks` fails, that step is SKIPPED. The four post-gate lints are diagnostics
// most worth reading on exactly the PRs that trip the gate, so suppressing them
// there is backwards (issue #1378). This already recurred once: a new step
// (check_negative_reciprocity.py) was added inheriting the buggy pattern. A code
// comment did not stop that; this test does, and it fails in the direction
// nothing else complains about (a green workflow that silently skips a lint).
//
// WHAT IT CANNOT COVER. That the steps actually RUN and report success/failure
// rather than skipped is only observable from a live Actions run (force the gate
// to `exit 1` on a draft PR and read the job's step conclusions) — see #1378.
// This test guards the YAML invariant that makes that behaviour possible.
//
// Run: node .github/tests/check-runlogs-post-gate-lints.test.mjs
import fs from "node:fs";

const WORKFLOW = ".github/workflows/check-runlogs.yml";
const GATE_RUN = "check_runlogs.py"; // the blocking gate step's run: command
// The post-gate diagnostics that must be present (non-vacuity anchor):
const EXPECTED_AFTER = [
  "check_tool_coverage.py",
  "check_rubric_tool_drift.py",
  "check_skill_frontmatter.py",
  "check_negative_reciprocity.py",
];

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL  ${msg}`); };

// Split the workflow's steps into blocks by `- name:` lines (this file has a
// single job, `runlogs`; if a second job with steps is ever added this over-scans
// into it, which fails loud, never silent). String parse, no yaml dep, matching
// this harness's checkout+node, no-install contract.
const lines = fs.readFileSync(WORKFLOW, "utf8").split("\n");
const steps = [];
for (const line of lines) {
  const m = line.match(/^(\s+)- name: (.+?)\s*$/);
  if (m) steps.push({ name: m[2], body: [line] });
  else if (steps.length) steps[steps.length - 1].body.push(line);
}
if (steps.length === 0) {
  fail(`${WORKFLOW}: no "- name:" steps found — renamed or reformatted?`);
}

const gateIdx = steps.findIndex((s) => s.body.join("\n").includes(GATE_RUN));
if (gateIdx === -1) {
  fail(`could not find the gate step (a step whose run: uses ${GATE_RUN}) — ` +
       `renamed or reformatted? Update GATE_RUN.`);
}

const after = gateIdx === -1 ? [] : steps.slice(gateIdx + 1);

// Non-vacuity: the four known diagnostics must all appear AFTER the gate. If a
// refactor moved one before the gate or dropped it, the invariant below would
// pass vacuously on the rest; this catches that.
for (const script of EXPECTED_AFTER) {
  if (!after.some((s) => s.body.join("\n").includes(script))) {
    fail(`${script} is not a step after the gate — moved before it, or removed? ` +
         `If the job was restructured, re-derive this test's expectations.`);
  }
}
if (after.length === 0) {
  fail(`no steps found after the gate — the invariant below would be vacuous.`);
}

// The invariant: every post-gate step's `if:` must contain `!cancelled()`.
for (const s of after) {
  const ifLine = s.body.find((l) => /^\s*if:/.test(l));
  if (!ifLine) {
    fail(`step "${s.name}" (after the gate) has no if: — it must be ` +
         `\`if: \${{ !cancelled() && steps.scope.outputs.relevant == 'true' }}\``);
  } else if (!ifLine.includes("!cancelled()")) {
    fail(`step "${s.name}" (after the gate) is missing !cancelled() in its if:, ` +
         `so a failing gate SKIPS it (#1378). Its if: is:${ifLine.trim()}`);
  }
}

if (failures === 0) {
  console.log(`ok    all ${after.length} post-gate steps carry !cancelled() in their if:`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
