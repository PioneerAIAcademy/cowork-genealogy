# The skill lifecycle — authoring, testing, and improving genealogy skills

This is the **start-here map** for the people who build and improve the
genealogy skills: how a skill goes from an idea to a tested, released,
continually-improved artifact. It is the **complete flow** end to end and the
entry point; it points at the detailed docs for each step rather than
restating them.

The work is done by a **genealogist and a developer pairing.**
Genealogists are learning to run tests; developers are learning
genealogy. Neither role does the whole loop alone — the genealogist owns
*what good looks like*, the developer owns *how the skill and harness
work*, and they decide together at the points that matter.

```
  1 create → 2 test → 3 review+annotate → 4 audit rubric → 5 improve body → 6 verify → 7 release
                                                                 │
                       8 optimize description  ◄── co-tune ──────┘

  One skill at a time. Body loop (5) = skill-improver, which proposes SKILL.md
  edits and routes test-data / triggering / rubric causes elsewhere.
  Description loop (8) = the vendored run_loop. Rubric audit (4) keeps the
  signal honest so (5) doesn't optimize toward a weak rubric.
```

| Role | Owns | Across the lifecycle |
|---|---|---|
| **Genealogist** | Correctness — does the skill do genealogy right? | Writes tests + rubric, runs the harness, annotates grades, judges whether a proposed edit is *genealogically* correct, blesses releases. |
| **Developer** | Mechanics — skills, scripts, harness, the loop. | Pairs on skill prose and scripts, runs the improver and the optimizer, builds the plugin, opens PRs, keeps the harness honest. |

If you're brand new, read the two walkthroughs first:
[`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md) (genealogist)
and [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md).

---

## The stages

### 1. Create / edit a skill

**Pair.** Write the SKILL.md to the prose standard in
[`docs/skill-authoring-guide.md`](skill-authoring-guide.md); for a new
tool-wrapping skill, scaffold it with the `cowork-skill-builder` agent
first. (The authoring guide's "What kind of skill are you writing?"
section covers whether it should be a skill at all and which of the three
kinds — workflow, reference, or guardrail — it is.) The genealogist drives
the domain content; the developer drives shape, frontmatter limits, and
any `scripts/` helper.

### 2. Test

**Pair, genealogist-led.** Run the harness one skill at a time:

```bash
make eval-skill SKILL=<skill>     # from repo root: rebuilds the engine if stale, then runs
# manual equivalent: cd eval/harness && uv run python run_tests.py --skill <skill>
```

The harness drives the skill against mocked tool responses in a seeded
starting state (a *scenario*), an LLM judge grades each run, and it saves
a **run-log** — the scores plus a snapshot of the exact skill, tests,
scenario, and fixtures used, so the run can be reproduced. Each full
`--skill` run writes a new run-log; running a single test (`--test`)
makes a throwaway "scratch" run that isn't saved. Tests are **slow
(~2–3 min each) and cost money** — scope every run to one skill, never run
several invocations at once (they fight for memory and get killed).

How to author a *good* test corpus is its own section below — it's the
single biggest lever on whether the rest of the loop works.

### 3. Review & annotate

**Genealogist.** Open the CRUD UI (`make eval-ui`, or `cd eval/app && npm
run dev`), read each run, and correct the judge's grades. The UI pre-fills
every dimension with the judge's score, so you only change the ones you
**disagree with** and add a comment on those (matching dimensions need no
comment). This is where human judgment enters the system — it's what every
later step trusts more than the raw judge score.

**One skill per PR, and you own the loop:** edit the skill and/or tests,
run the harness, correct the grades, commit all of it (skill edits + test
changes + run-log + your corrections), and open the PR. A senior reviews it
via the GitHub diff + the CRUD UI and leaves feedback as **PR comments** —
respond by re-running and pushing a *new commit per round* (don't amend).
The senior is the gate: they release when the corrected grades show a real
improvement and the skill + tests look right — a holistic judgment, not a
number. Most PRs land in 1–2 rounds; 3+ is a signal to flag a senior
engineer rather than grind.

**Write correction comments a machine can act on.** A comment is the
highest-signal input the improver gets, and "judge over-credited" is
useless to it. Use three parts:

> **Did:** what the skill actually did.
> **Should:** what it should have done.
> **Gap:** which SKILL.md guidance is missing, wrong, or being ignored.

Example: *"Did: labeled the conflicting birthplaces a soft conflict.
Should: a hard conflict — two primary informants disagree. Gap: the
skill body never says primary-vs-primary disagreement is hard."* That
comment is an edit waiting to happen; the first one isn't.

### 4. Audit the rubric (periodic; before a body-optimization push)

**Pair.** Before trusting the improver to optimize toward a rubric, make sure
the rubric *discriminates*. The **rubric-critic** agent (read-only) reads a
skill's run logs (best across versions) + `.ann` corrections + `rubric.md` and
flags non-discriminating dimensions (always 3 or always 1), flaky dimensions,
dimensions no test exercises, and systematic judge-vs-human disagreement.
Invoke it in Claude Code: *"audit the rubric for `<skill>`"*. It only
*suggests* — rubric edits are the senior's, judge-prompt edits a separate
cadence. A skill-improver that hill-climbs a weak rubric optimizes noise, so
run this periodically and whenever a dimension looks off.

### 5. Improve the skill body

**The lane rule — classify every finding BEFORE touching skill prose.**
The 2026-07 record-extraction audit found most of a month's SKILL.md
edits were tool bugs or eval bugs wearing skill-prose clothing — teams
patched a 780-line prompt because it was the only lever they held, while
the real defect lived elsewhere. Every e2e/eval/user finding gets a lane
first:

1. **Tooling defect** (rejected valid payloads, missing tool capability,
   silent corruption) → MCP tool PR + vitest; prose never compensates
   for a tool bug.
2. **Eval defect** (judge confabulation, rubric contradicting the skill,
   fixture expecting stale contracts) → rubric / judge-prompt / fixture
   PR. If the skill followed its instructions and got dinged, the eval
   is the bug.
3. **Record-type craft gap** (a death-cert/probate/church nuance) → that
   record type's playbook/table, not new global prose.
4. **Core doctrine** (a genuine cross-record-type behavior change) →
   SKILL.md / agent-body edit, stewarded, gated by the unit suite.

Lanes 1–2 merge conflict-free and in parallel; only lane 4 touches the
contended prompt. When in doubt between 2 and 4, check whether the
transcript shows the skill *following* its written instruction — if yes,
it's lane 2.

**Pair.** Cluster the failures across the skill's tests and revise the
SKILL.md prose to fix them — explaining the *why*, not bolting on
another MUST (see the authoring guide). The **skill-improver** agent
(report-only) assists by reading the latest annotated run-log,
clustering, and proposing an evidence-cited diff for the pair to approve.
Invoke it in Claude Code: *"improve `<skill>` from its eval results"*. It
**routes by cause** — a correction that actually points at a test-data gap, a
triggering miss, or a rubric problem goes to the test author / description
optimizer (step 8) / rubric review (step 4), not into a body edit; only a
body-located cause becomes SKILL.md prose. Either way the discipline is the same:

- **Generalize, don't patch the case.** The test is the question, not the
  answer key. Ask "does this edit read as a general principle?" An edit
  that only helps the Flynn scenario is a regression in disguise. This —
  not a statistical hold-out — is the primary overfitting guard at our
  test counts.
- **Hold out a few tests.** Mark ~2–3 of the skill's tests as holdout —
  flip the **"Hold out from the skill-improver"** switch on each test in
  the CRUD UI (it sets `holdout: true`; no need to hand-edit JSON). The
  improver never reads them while forming an edit; they exist only to
  check the edit helped cases it wasn't written from. Keep them stable —
  don't rewrite a holdout test to make it pass.
- **Trust the human over the judge.** Where a correction comment
  disagrees with the judge, the comment governs the edit. Don't tune the
  skill toward judge quirks — that's the judge prompt's problem, on a
  separate cadence.
- **Subtract, too.** If a run shows the skill sending the model down
  unproductive paths, delete the offending instruction. Net SKILL.md
  length should trend flat or down, not always up.

**When the trigger is a real user bug** (a feedback report) instead of an
annotated run-log, the on-ramp differs but the machinery is the same.
First **reproduce it live** — replay the user's exact prompt against the
real skill and watch the bug happen before you change anything; live APIs
are noisy, so re-run once if it doesn't show. Between fix attempts, reset
*two* things: start a fresh conversation (so the agent isn't anchored on
its earlier bad reasoning) and reset the case's data to its starting state
(leftover changes contaminate the next run). Once it's fixed, **promote
the case into a regression test** so it can't silently come back, and let
the commit message be the lesson — what went wrong and why the fix works.

### 6. Verify the fix

**Pair.** We are early in the cycle — **catching big problems, not
polishing small ones** — so verification is cheap and qualitative, not a
statistical bake-off:

- **Re-run only the affected tests** while iterating (`--test <id>`);
  reserve the full `--skill` run for the release candidate.
- **One run is enough for a big fix.** A real problem is a dimension that
  fails *consistently* (a 1, not a flicker); a single run sees that.
  Don't require multiple runs to chase small score deltas you can't trust
  — the harness has no `temperature=0`, so treat a sub-noise movement as
  noise, not victory. (Bump `runs_per_test` only when you genuinely need
  to measure a marginal change later.)
- **Gate on the named problem, not the mean.** The question is "did the
  dimension that was failing now pass, with nothing obvious regressing?"
  — a binary a single run answers — not "did the weighted mean rise by
  X."

### 7. Release

**Senior blesses, developer ships.** Each full run you commit is a
**candidate**; a senior reviews the corrected grades and clicks **Release**
on the good one, which makes it the official version (v1, v2, … — one
released run-log per version). Before they can, the run-log must be
**active** — its snapshot still matches the skill files in the repo. Edit
SKILL.md or a test and the UI shows "no active version" until you re-run
the harness; that's your signal the latest results are stale. It must also
be fully annotated. CI enforces both.

### 8. Optimize the description (separate, automated loop)

**Developer.** A skill has two parts that are tuned separately: the
one-line **description** controls *when* the skill fires; the **body**
(steps 5–7) teaches Claude *how* to do the task. A *triggering* problem —
the skill fires when it shouldn't, or doesn't when it should — is a
**description** fix; an "it did the task wrong" problem is a **body** fix.
Don't conflate them.

The description optimizer builds should-trigger / should-not-trigger query
sets for free from your positive and negative tests, then tunes the
description against them. Run it on demand (it makes real `claude -p` calls
— network + model cost, **not** CI):

```bash
make optimize-skill SKILL=<skill>   # build the trigger query set, then run the optimizer
# no make? cd eval/triggering, then run these two:
#   uv run python build_eval_set.py --skill <skill>
#   uv run python -m scripts.run_loop --eval-set eval_sets/<skill>.json \
#     --skill-path ../../packages/engine/plugin/skills/<skill> --model <session-model>
```

It tunes the **description only** — it never runs the skill or a tool.
Apply the proposed new description as a human-reviewed SKILL.md edit; the
optimizer's report lands in `eval/runlogs/optimizer/`, separate from your
test run-logs.

**The two loops interact, so sequence them.** Fix the body first — a skill
that never fires can't be body-improved. After a body change that alters
*what the skill does*, re-run the description optimizer (the old triggers
may no longer fit). After a description change, re-run the skill's tests to
confirm its behavior didn't move. Body first, then description.

---

## Authoring a test corpus that the loop can actually use

A test is four things you fill in the CRUD UI — no JSON: the **user
message**, a starting **scenario** (project state) from a dropdown,
optional **fixtures** (canned tool responses so the skill doesn't hit a
live API), and plain-English **criteria**. You can ship a useful test with
just a message and a scenario — the skill's shared rubric does the heavy
grading; your criteria only add what's unique to *this* case. (If no
scenario fits, pick the closest and note the gap — the test saves but
won't run until a developer builds the matching scenario.)

Aim for **at least 8 tests per skill** — no upper bound; we don't yet know
enough to set one. Spend them on **coverage, not repetition**: eight easy
happy-path tests can't tell a good skill from a bad one. Each skill's set
should span:

- **Positive** — the skill should fire and do the task well (happy path
  *and* messier variants).
- **Negative / routing** — a near-miss that should go to a *different*
  skill (you name which one, or "none"). Mine these from the "Do NOT use
  when…" clauses in the description (see the authoring guide); build them
  from both directions of each confusable pair.
- **Edge cases** — the messy genealogy realities: conflicting records,
  missing data, ambiguous places, multi-person households.
- **At least one hard case** — something the skill currently gets wrong.
  A corpus with no failures has nothing to improve against.

Then mark **2–3 diverse, representative tests as holdout** up front —
toggle the "Hold out from the skill-improver" switch on each in the CRUD
UI. Authoring the hold-out into the corpus now is far cheaper than carving
it out after the improver has already been trained against everything.

Keep your criteria **neutral** — grade the *reasoning*, never a preferred
answer. "Should resolve in favor of the Irish birthplace" is leakage: the
judge then just agrees with you. Rewrite it to "resolution should weigh
informant proximity as a factor, regardless of which birthplace it picks."
The test: would a genealogist who reached the *opposite* conclusion still
call your criterion fair? If not, it's leaking — the biggest validity
threat to LLM-as-judge grading.

---

## Is the loop working?

The real metric isn't pass rate — it's whether the system **compounds.**
When you catch the *same kind of mistake* across several tests, stop fixing
it by hand: push it down into something that catches it automatically. A
yes/no check on a single output (e.g. "citation missing") becomes an
automated test; something you only see by reading the whole output and
weighing it (e.g. "overconfident conclusion") becomes a **rubric**
dimension. If you're still hand-catching the same class of issue ten rounds
in, the loop isn't learning.

## Status

Every step has tooling in place:

- **Author** — the authoring guide + a blocking frontmatter lint in CI.
- **Test** — `make eval-skill SKILL=<name>` (or `cd eval/harness && uv run python run_tests.py --skill <name>`).
- **Review** — the CRUD UI (`make eval-ui`, or `cd eval/app && npm run dev`) + the holdout toggle.
- **Audit** — the `rubric-critic` agent.
- **Improve** — the `skill-improver` agent (report-only: it proposes
  evidence-cited SKILL.md edits and routes non-body causes elsewhere; the
  pair applies, re-runs, and commits — it never edits files itself).
- **Optimize** — `make optimize-skill SKILL=<name>` (on-demand; manual commands in step 8).

**To run the skill-improver on skill `X`:** it needs an *active*,
*annotated* run-log. So run the harness on current code (`make eval-skill
SKILL=X`, or `cd eval/harness && uv run python run_tests.py --skill X`),
annotate the candidate in the CRUD UI, then ask Claude Code to "improve `X`
from its eval results". Against a stale or unannotated run-log it proposes
nothing and asks you to re-run — that's correct, not a failure.

## Doc index

Everyday docs:

| You want to… | Go to |
|---|---|
| Write a SKILL.md well | [`docs/skill-authoring-guide.md`](skill-authoring-guide.md) |
| Run the harness / read a run-log | [`eval/README.md`](../eval/README.md) |
| Audit a skill's rubric quality | the `rubric-critic` agent — `.claude/agents/rubric-critic.md` |
| Improve a SKILL.md body from eval results | the `skill-improver` agent — `.claude/agents/skill-improver.md` |
| Do your first PR (genealogist / senior) | [`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md), [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md) |

**Go deeper only if you're changing the machinery itself** — you don't need
these to follow the flow above:

| Topic | Spec / plan |
|---|---|
| Skill architecture & the three skill kinds | [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md) |
| Test JSON format, fixtures, validators | [`docs/specs/unit-test-spec.md`](specs/unit-test-spec.md) |
| Per-PR review + run-log release/active/candidate mechanics | [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md), [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md) |
| The full evaluation + optimizer design | [`docs/plan/skill-mcp-optimization-plan.md`](plan/skill-mcp-optimization-plan.md) |
| The vendored description optimizer | `eval/triggering/` (vendoring notes in `VENDORED.md`) |
| Triaging an actual user feedback zip (per-platform setup + click-paths) | [`docs/feedback-workflow.md`](feedback-workflow.md) — superseded as the canonical flow by this doc |
