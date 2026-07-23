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
  0 branch → 1 create → 2 test → 3 review+annotate → 4 audit rubric →
                             5 improve body → 6 verify → 7 release
                                    │
              8 optimize description  ◄── co-tune ──┘

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

## Three on-ramps, one loop

A skill problem reaches you from one of three places. The on-ramp differs;
everything from "capture it as a test" onward is this page.

| Where the problem surfaced | Start there | Joins here at |
|---|---|---|
| You noticed it while researching in Cowork | the worked example at the bottom of this page | step 2 |
| An e2e benchmark run missed a finding | [`e2e-testing-guide.md`](e2e-testing-guide.md) | step 2, via `/mine-unit-test --e2e-run <dir>` |
| An alpha tester submitted a feedback zip | [`alpha-feedback-guide.md`](alpha-feedback-guide.md) | step 2, via `/mine-unit-test --project <case-dir>` |

Whichever door you came through, the first question is the same — and it is
**not** "how do I edit the skill." It's **whose fault is it?** See the lane rule
in step 5, and answer it before you touch prose.

## Where each step happens

Every stage below opens with a **Who / Where / How** line. There are only
three places, and each command has both a `make` form and a Windows
double-click form — use whichever your machine has:

| Icon | Place | What it is | How you run things there |
|---|---|---|---|
| ⌨️ | **Terminal** | A shell at the repo root (macOS/Linux) — or File Explorer on Windows, where you double-click a `.bat` in `eval\`. | `make <target>` — Windows: double-click `eval\<Name>.bat`, which prompts for the skill or test name instead of taking `SKILL=`/`TEST=` arguments. |
| 🤖 | **Claude Code** | A `claude` session started at the repo root — **not** Cowork. This is where the repo-local dev skills and agents live. | Type the slash command, e.g. `/improve-skill citation`. |
| 🖥️ | **Cowork** | The real product, with the plugin + MCP extension installed. | Only for trying a skill by hand in the shipping product. Rebuild and reinstall the artifacts first: `make plugin` (Windows: `eval\BuildPlugin.bat`) and `make mcpb` (Windows: `eval\BuildMcpb.bat`), then remove the old plugin in Cowork → Customize, upload the new `.zip`, and fully quit and reopen Desktop. |

Rule of thumb: **Claude Code = you ask Claude to do something. Terminal = you
run a command yourself. Cowork = you do genealogy.**

Two more surfaces show up alongside those three. The **grading UI** (step 3) is
a 🌐 browser tab that `make eval-ui` opens. The **Research Viewer** (Electron,
`make electron`) renders the research log, assertions, conflicts and sources of
whichever project folder you point it at — it's how you *see* what the agent
wrote rather than trusting the chat's summary of itself, so open it whenever you
open a project in Cowork.

**Everything happens in one checkout, on one branch.** `make eval-skill` and
`make gate-skill` test the working tree, so that's where your skill edit has to
be; Claude Code opens at the same repo root, because `mine-unit-test` writes into
`eval/` relative to where you started it. The one exception is the **project
folder you research in** — a seeded scratch project under
`eval/e2e-project/<slug>/`, or an unpacked feedback case under
`~/feedback/<slug>/`. Those are research data, not repo source.

The `.bat` files live in `eval\` and are listed in
[`eval/README.md`](../eval/README.md). Windows users never need `make`, and
macOS/Linux users never need the `.bat` files — every step is available both
ways.

---

## The stages

### 0. Make a branch

**Who:** whoever is driving. **Where:** ⌨️ terminal (or GitHub Desktop).
**How:**

```bash
git checkout main && git pull
git checkout -b <your-name>-<skill>        # e.g. dallan-citation
```

**GitHub Desktop:** Current Branch dropdown → **New branch…** → name it
`<your-name>-<skill>` → base it on `main` → **Create branch**.

Do this **first**, before you touch a file — and specifically before you seed a
project or unpack a feedback case. Both setup paths stamp your checkout *as it
is when you run them*, and the test you mine later lands on whatever branch is
checked out then. Unpack a case while still on `main` and your test ends up on
`main`.

Everything the rest of the loop produces — the SKILL.md edit, new tests, the run
log, your grading corrections — is committed together on this one branch. Pushes
to `main` are blocked, so starting on `main` just means moving the work later.

### 1. Create / edit a skill

**Who:** pair. **Where:** 🤖 Claude Code at the repo root (or any text editor —
the skill is just `packages/engine/plugin/skills/<skill>/SKILL.md`).
**How:** for a new tool-wrapping skill, ask Claude Code to scaffold it with
the `cowork-skill-builder` agent; otherwise edit the file directly.

Write the SKILL.md to the prose standard in
[`docs/skill-authoring-guide.md`](skill-authoring-guide.md). (The authoring
guide's "What kind of skill are you writing?" section covers whether it
should be a skill at all and which of the three kinds — workflow,
reference, or guardrail — it is.) The genealogist drives the domain
content; the developer drives shape, frontmatter limits, and any
`scripts/` helper.

### 2. Test

**Who:** pair, genealogist-led. **Where:** ⌨️ terminal at the repo root.
**How:**

```bash
make eval-skill SKILL=<skill>     # rebuilds the engine if stale, then runs
```

**Windows:** double-click `eval\RunTests.bat` — it rebuilds the MCP server
and then asks which skill to test.

The harness drives the skill against mocked tool responses in a seeded
starting state (a *scenario*), an LLM judge grades each run, and it saves
a **run-log** — the scores plus a snapshot of the exact skill, tests,
scenario, and fixtures used, so the run can be reproduced. Each run here
writes a new run-log — the releasable candidate; the step-6 gate runs a
single test instead and deliberately writes none. Tests are **slow
(~2–3 min each) and cost money** — scope every run to one skill, never run
several invocations at once (they fight for memory and get killed).

**Arriving from a real failure? Capture it as a test first.** If you got here
because something went wrong in Cowork, in an e2e run, or in a user's feedback
zip, run this in 🤖 Claude Code *before* the run above:

```
/mine-unit-test                            # asks what it needs
/mine-unit-test --project <dir>            # a research project or feedback case folder
/mine-unit-test --e2e-run <dir>            # a recorded e2e run that missed a finding
/mine-unit-test --skill <name>             # skip the "which sub-skill?" question
```

It writes a draft test, a scenario carved from the mid-flow state the sub-skill
actually saw, and mock fixtures built from the saved tool responses — all under
`eval/tests/unit/<skill>/` and `eval/fixtures/`. Skim the draft and check **one
thing above all: the test must state the general rule**, not the specific case.
"Any census record with a page/line must include it" is a test; "this one
Schuster record" is a fake win that turns green without the skill getting
better. (The scenario carve is the part most worth a second look.)

It prints the new test's **id** — `ut_<skill>_<NNN>`, e.g. `ut_citation_019`,
which is also the `id` field in the file it wrote. That's the `TEST=` value for
step 6.

> **Mine the test *before* you fix the bug.** Step 6's gate scores your edit
> against the *pre-edit* annotated baseline for this test. Capture it after the
> fix has landed and the bug no longer reproduces on the incumbent skill, so
> the gate returns `INCONCLUSIVE` and proves nothing either way.

How to author a *good* test corpus is its own section below — it's the
single biggest lever on whether the rest of the loop works.

### 3. Review & annotate

**Who:** genealogist. **Where:** 🌐 the CRUD UI in your browser
(<http://localhost:3000>), started from a terminal. **How:**

```bash
make eval-ui                      # then open http://localhost:3000
```

**Windows:** double-click `eval\Start.bat` — it starts the UI and opens the
browser tab for you. Leave that window open while you work; closing it stops
the app.

> **First time improving this skill? Set its hold-out tests *before* the step-2
> run.** Hold-outs are 2–3 *individual* unit tests (not whole runs) that the
> improver in step 5 is forbidden to look at, so they can catch a "fix" that
> only games the tests it was shown. Step 6's gate runs them as its
> no-regression half — **if the skill has none, that half is silently inert and
> the gate's LOOKS GOOD means less than it appears.** Set them here: open each
> test and flip the **"Hold out from the skill-improver"** switch on. Pick
> diverse, stable ones and leave them set.
>
> Toggling hold-out is a grading-relevant change, so doing it *after* the step-2
> run invalidates the very baseline the gate compares against. If you've already
> run, set the flags and re-run before continuing.

Read each run and correct the judge's grades. The UI pre-fills
every dimension with the judge's score, so you only change the ones you
**disagree with** and add a comment on those (matching dimensions need no
comment). This is where human judgment enters the system — it's what every
later step trusts more than the raw judge score.

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

This is not optional bookkeeping for a freshly-mined test: **the improver
proposes nothing for a lone new test that carries no human comment.** If you
arrived from a real failure you already wrote the Did/Should/Gap note when you
noticed it — this is where it goes on the record.

**One skill per PR, and you own the loop:** edit the skill and/or tests,
run the harness, correct the grades, commit all of it (skill edits + test
changes + run-log + your corrections), and open the PR. A senior reviews it
via the GitHub diff + the CRUD UI and leaves feedback as **PR comments** —
respond by re-running and pushing a *new commit per round* (don't amend).
The senior is the gate: they release when the corrected grades show a real
improvement and the skill + tests look right — a holistic judgment, not a
number. Most PRs land in 1–2 rounds; 3+ is a signal to flag a senior
engineer rather than grind.

### 4. Audit the rubric (periodic; before a body-optimization push)

**Who:** pair. **Where:** 🤖 Claude Code at the repo root — not Cowork, not the
terminal. **How:**

```
/audit-rubric <skill>
```

Type the slash command; don't ask for it in prose (see "Type the commands"
below for why that matters). There is no `make` target or `.bat` for this
one — it runs inside Claude Code.

Before trusting the improver to optimize toward a rubric, make sure
the rubric *discriminates*. The **rubric-critic** agent (read-only) reads a
skill's run logs (best across versions) + `.ann` corrections + `rubric.md` and
flags non-discriminating dimensions (always 3 or always 1), flaky dimensions,
dimensions no test exercises, and systematic judge-vs-human disagreement. It
only *suggests* — rubric edits are the senior's, judge-prompt edits a separate
cadence. A skill-improver that hill-climbs a weak rubric optimizes noise, so
run this periodically and whenever a dimension looks off.

### 5. Improve the skill body

**Who:** pair. **Where:** 🤖 Claude Code at the repo root. **How:**

```
/improve-skill <skill>
```

The agent is report-only: it proposes a diff, you apply it (in Claude Code
or any editor). No `make` target or `.bat` — it runs inside Claude Code.

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

**In the field, that classification is three questions asked against the saved
tool responses** — the `results/` files in the project or case folder, which
record what the tools actually returned:

- The tool **returned** the data and the skill dropped or misused it → a
  **skill** problem (lane 3 or 4). Continue.
- The tool **never returned** it → a **tool** problem (lane 1). Different fix,
  an engineering ticket, not a prose edit. Stop here.
- The skill did the right thing and the test or rubric would mark it wrong → a
  **grading** problem (lane 2). That goes to step 4, not into the body.

Skipping this check is the classic trap: rewriting a skill's instructions for a
bug that actually lives in a tool.

Cluster the failures across the skill's tests and revise the
SKILL.md prose to fix them — explaining the *why*, not bolting on
another MUST (see the authoring guide). The **skill-improver** agent
(report-only) assists by reading the latest annotated run-log,
clustering, and proposing an evidence-cited diff for the pair to approve. It
**routes by cause** — a correction that actually points at a test-data gap, a
triggering miss, or a rubric problem goes to the test author / description
optimizer (step 8) / rubric review (step 4), not into a body edit; only a
body-located cause becomes SKILL.md prose. It proposes **at most 3** edits.
Either way the discipline is the same:

- **Generalize, don't patch the case.** The test is the question, not the
  answer key. Ask "does this edit read as a general principle?" An edit
  that only helps the Flynn scenario is a regression in disguise. This —
  not a statistical hold-out — is the primary overfitting guard at our
  test counts.
- **Hold out a few tests.** Marked back in step 3; the improver never reads
  them while forming an edit. They exist only to check the edit helped cases
  it wasn't written from. Keep them stable — don't rewrite a holdout test to
  make it pass.
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
are noisy, so re-run once if it doesn't show. Do that replay in 🤖 **Claude
Code opened on the unpacked case directory**, which is the cheap loop — the
skills are symlinked in, so an edit takes effect on the next run with no
rebuild. Between fix attempts, reset *two* things: start a fresh conversation
(so the agent isn't anchored on its earlier bad reasoning) and reset the case's
data with `make feedback-reset CASE=<dir>` (leftover changes contaminate the
next run). Full walkthrough:
[`alpha-feedback-guide.md`](alpha-feedback-guide.md).

### 6. Verify the fix

**Who:** pair. **Where:** ⌨️ terminal at the repo root. **How:**

```bash
make gate-skill SKILL=<skill> TEST=<test-id>
```

**Windows:** double-click `eval\GateSkill.bat` — it asks for the skill and
the test id.

We are early in the cycle — **catching big problems, not
polishing small ones** — so verification is cheap and qualitative, not a
statistical bake-off:

- **Iterate with the gate, not the full suite.** `make gate-skill` runs only
  the affected test plus the hold-outs; reserve the full `make eval-skill`
  run for the release candidate.
- **One run is enough for a big fix.** A real problem is a dimension that
  fails *consistently* (a 1, not a flicker); a single run sees that.
  Don't require multiple runs to chase small score deltas you can't trust
  — the skill run has no `temperature=0` (only the judge is pinned), so
  treat a sub-noise movement as noise, not victory. (Bump `runs_per_test`
  only when you genuinely need to measure a marginal change later.)
- **Gate on the named problem, not the mean.** The question is "did the
  dimension that was failing now pass, with nothing obvious regressing?"
  — a binary a single run answers — not "did the weighted mean rise by
  X."

**The gate answers that binary for you.** Apply the improver's edits to
SKILL.md **first**, then run it. It runs the named test plus the skill's
hold-out set against your edited skill and compares to the **annotated**
scores from your pre-edit run — so
you're measuring against human ground truth, not judge-versus-judge. It
prints one of:

- **LOOKS GOOD** — the failing dimension passes and nothing regressed.
- **NEEDS YOUR EYES** — the fix didn't land, or a hold-out dropped. Read the
  table, adjust the edit in `SKILL.md`, and re-run — don't open the PR yet.
- **INCONCLUSIVE** — the bug never reproduced on the *old* skill, so nothing
  was proven either way. Usually a too-weak test; grading isn't deterministic,
  so re-run once before going back to step 2 for a sharper test.

It's advice, not a verdict — you still decide. Two things to know: it needs a
pre-edit annotated run to compare against, and **it writes no run logs**,
which is why it's cheap enough to iterate on and why the release run in step 7
still has to happen.

> **Why not just re-run `make eval-skill` and diff the scores?** You could, and
> you'd get a worse answer for more money. Four differences:
>
> - **It runs one side, not two.** The "before" numbers come from the step-2 run
>   log you already have. A re-run-and-compare pays for a full suite twice and
>   needs you to grade both.
> - **The "before" side is human ground truth.** The gate overlays your `.ann`
>   corrections onto the step-2 scores. Comparing two raw runs compares judge to
>   judge — and the judge is the thing you just spent step 4 not fully trusting.
> - **It's the mined test + hold-outs, not the whole suite** — seconds, so you
>   can iterate on the edit instead of committing to it.
> - **It tells you when the *test* is the problem.** `INCONCLUSIVE` means the
>   bug never reproduced on the un-edited skill, so nothing was proven either
>   way. A score diff can't distinguish that from "the fix didn't work" — it
>   just shows two passing runs and you conclude, wrongly, that you're done.

### 7. Release

**Who:** senior blesses, developer ships. **Where:** two places — ⌨️ a terminal
for the release run and the push, 🌐 the CRUD UI for the Release click.
**How:**

1. **Terminal** — do the full release run on the edited skill (the gate in
   step 6 writes no run log, so this is not optional):

   ```bash
   make eval-skill SKILL=<skill>          # Windows: eval\RunTests.bat
   ```

2. **CRUD UI** (`make eval-ui`; Windows: `eval\Start.bat`) — grade it: click
   **Agree with all**, then correct only the few dimensions you actually
   disagree with. **Every** dimension has to be reviewed; CI fails on a
   partly-annotated run.

3. **Terminal or GitHub Desktop** — commit the skill edit, the new test *and
   its scenario folder and mock fixtures* (commit only the test JSON and it
   can't run), the run log and its `.ann.json` together, push the step-0
   branch, and open the PR:

   ```bash
   git add packages/engine/plugin/skills/<skill>/ eval/tests/unit/<skill>/ \
           eval/fixtures/scenarios/<slug>/ eval/fixtures/mcp/ \
           eval/runlogs/unit/<skill>/
   git commit -m "<skill>: <what changed and why>"
   git push -u origin <your-branch>
   gh pr create                            # or open the PR from GitHub's web UI
   ```

   The commit message *is* the lesson — explain what went wrong and what
   changed. There's no separate lesson file by design.

4. **CRUD UI, senior** — they review the PR diff plus your corrected grades,
   then click **Release** on the good candidate and push that rename to your
   branch. The project owner merges.

Each full run you commit is a **candidate**; releasing one makes it the
official version (v1, v2, … — one released run-log per version). The
`check-runlogs` CI gate is blocking and checks two things your step-2 run can no
longer satisfy, because `SKILL.md` changed underneath it:

- the latest run log per touched skill must be **active** — its embedded
  snapshot still matching the branch's current skill files. Edit SKILL.md or a
  test and the UI shows "no active version" until you re-run the harness;
  that's your signal the latest results are stale.
- its `.ann.json` must carry a correction for **every** (test, dimension) pair.

**One *problem* per PR — which is usually, but not always, one skill.** A
locator rule that belongs in `citation` alone is a one-skill PR. But some fixes
genuinely span skills: a doctrine change about how evidence is classified may
have to land in `person-evidence`, `conflict-resolution` and `proof-conclusion`
together, because shipping it in one and not the others leaves the skills
contradicting each other mid-research. When that happens, edit them all in the
same PR — and run `make eval-skill` for **each** touched skill, since the runlog
gate checks every skill the PR touches, not just the first. What you should not
do is bundle two *unrelated* fixes because they happened to be on your branch at
the same time.

**Want to see it in the real product before you ship?** That's the one step that
happens in 🖥️ **Cowork**: `make plugin` and `make mcpb` (Windows:
`eval\BuildPlugin.bat`, `eval\BuildMcpb.bat`), remove the old plugin in Cowork →
Customize, upload the new `.zip`, install the `.mcpb` in Desktop → Settings →
Extensions, then fully quit and reopen Desktop. Cowork runs the uploaded plugin
`.zip`, not your working tree — skip the rebuild and the fix will look like it
did nothing. Optional in general: the harness run, not the Cowork walkthrough, is
what CI and the release gate check. The one place it is *not* optional is an
alpha feedback case, where a paired Cowork verification is a specced pre-PR step
— see [`alpha-feedback-guide.md`](alpha-feedback-guide.md).

### 8. Optimize the description (separate, automated loop)

**Who:** developer. **Where:** ⌨️ terminal at the repo root. **How:**

```bash
make optimize-skill SKILL=<skill>
```

**Windows:** double-click `eval\OptimizeSkill.bat` — it asks which skill's
description to tune. Both forms build the trigger query set and then run the
optimizer; it makes real `claude -p` calls, so it needs network and costs
money, and it is **not** in CI.

A skill has two parts that are tuned separately: the
one-line **description** controls *when* the skill fires; the **body**
(steps 5–7) teaches Claude *how* to do the task. A *triggering* problem —
the skill fires when it shouldn't, or doesn't when it should — is a
**description** fix; an "it did the task wrong" problem is a **body** fix.
Don't conflate them.

The optimizer builds should-trigger / should-not-trigger query sets for free
from your positive and negative tests, then tunes the description against
them. It tunes the **description only** — it never runs the skill or a tool.
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

## Command card

Every step has tooling in place. The whole loop, in one table:

| Step | Where | macOS / Linux | Windows |
|---|---|---|---|
| 0 Branch | ⌨️ terminal | `git checkout -b <name>` | GitHub Desktop → New branch… |
| 1 Author | 🤖 Claude Code / editor | the authoring guide + a blocking frontmatter lint in CI | same |
| 2 Capture *(from a real failure)* | 🤖 Claude Code | `/mine-unit-test [--project \| --e2e-run <dir>]` | same |
| 2 Test | ⌨️ terminal | `make eval-skill SKILL=<name>` | `eval\RunTests.bat` |
| 3 Review | 🌐 CRUD UI (browser) | `make eval-ui` | `eval\Start.bat` |
| 4 Audit | 🤖 Claude Code | `/audit-rubric <name>` | `/audit-rubric <name>` |
| 5 Improve | 🤖 Claude Code | `/improve-skill <name>` | `/improve-skill <name>` |
| 6 Gate | ⌨️ terminal | `make gate-skill SKILL=<name> TEST=<id>` | `eval\GateSkill.bat` |
| 7 Release | ⌨️ terminal + 🌐 CRUD UI | `make eval-skill`, then Release in the UI, then push + PR | `eval\RunTests.bat`, then Release in the UI, then GitHub Desktop |
| 8 Optimize | ⌨️ terminal | `make optimize-skill SKILL=<name>` | `eval\OptimizeSkill.bat` |
| *(optional)* try it in Cowork | 🖥️ Cowork | `make plugin`, `make mcpb` | `eval\BuildPlugin.bat`, `eval\BuildMcpb.bat` |

Steps 4 and 5 are Claude Code slash commands on both platforms — the agents
(`rubric-critic`, `skill-improver`) are read-only and propose edits you
apply. The `.bat` files prompt for the skill or test name instead of taking
`SKILL=`/`TEST=` arguments; they are listed in
[`eval/README.md`](../eval/README.md).

**To run the improver on skill `X`:** it needs an *active*, *annotated*
run-log. So run the harness on current code (`make eval-skill SKILL=X`;
Windows `eval\RunTests.bat`), annotate the candidate in the CRUD UI, then
type `/improve-skill X`. Against a stale or unannotated run-log it proposes
nothing and asks you to re-run — that's correct, not a failure.

**Type the commands rather than asking in prose.** Both agents are read-only
by construction — they propose, you apply. Phrasing it as a request relies on
description matching, and a miss doesn't fail loudly: you get ordinary Claude,
which *does* have Edit and Write, doing the job instead, and the 3-edit budget
and the you-apply-them gate quietly disappear. The commands also check you're
at the repo root and warn when hold-outs or annotations are missing.

---

## Worked example: a citation nobody could find again

The stages above are the reference. This is one run through them, start to
finish, for a pair doing it the first time — with the place marked at every
step.

> **The roles and names are for the story.** "Ana" (genealogist) and "Ben"
> (developer) split the work to make it concrete, but the split is only
> illustrative — **anyone can do any step they're comfortable with**, and one
> person can run the whole loop. The Schuster family and the `schuster-census`
> slug are invented too; for a real run, use an existing fixture slug from
> `eval/tests/e2e/`.

**The problem.** Ana is researching the Schuster family. She asks Claude to
cite a 1900 U.S. census record she just used. The `citation` skill writes a
tidy-looking citation — but it **leaves out the page and line number**. Without
that, no one could ever open that exact record again.

> **Before you start (one-time setup).** Two things gate this loop; skip them
> and the steps below silently do nothing.
> - **Cowork steps (1 and 7)** need the genealogy tools installed *into
>   Cowork*: log in to FamilySearch (`make e2e-login` / `eval\Login.bat`, once
>   a day), then `make mcpb` and `make plugin` (Windows: `eval\BuildMcpb.bat`,
>   `eval\BuildPlugin.bat`). Plain `make engine-build` wires only the Claude
>   Code side — in Cowork the project would open with no tools and there'd be
>   nothing to notice or confirm.
> - **Grading steps (4 and 8)** call the LLM judge, which needs an Anthropic
>   API key in `eval/.env` (`ANTHROPIC_API_KEY=…`; `Setup.bat` sets this on
>   Windows). Without it every dimension comes back *ungraded* and the loop
>   produces nothing gradeable.
>
> The middle steps run on saved mock data, so you don't need to be online for
> them.

### Step 0 — Branch ⌨️ Terminal

```
git checkout -b citation-locator
```

**Windows (GitHub Desktop):** Current Branch dropdown → **New branch…** → name
it `citation-locator`, base it on `main` → **Create branch**.

### Step 1 — Notice it 🖥️ Cowork + Viewer

Ana is working in a practice project. Ben seeded it for her earlier from a
terminal:

```
make e2e-project TEST=schuster-census        # Windows: eval\SeedProject.bat
```

That writes an editable project into `eval/e2e-project/schuster-census/`. Ana
opens that folder in **two** places: **Cowork**, to do the research, and the
**Research Viewer**, to watch what gets written — launched from a *second*
terminal and left running:

```
make electron                                # Windows: eval\Viewer.bat
```

Then **Open Project** in the viewer and pick the same
`eval/e2e-project/schuster-census/` folder. It live-updates as the agent works.
Skip this and you're judging the research from the chat transcript alone, which
is exactly how a bad citation slips past.

Mid-research she spots it and writes down, in plain words, what's wrong:

> **Did:** the citation gave the census year and county but no page or line.
> **Should:** it must include the page/line so the record can be found again.
> **Gap:** the citation skill never says a citation has to be *relocatable*.

That three-part note is the single most valuable thing she produces all day.
Keep it — it goes on the record in Step 4 and drives Step 5.

### Step 2 — Is it even the skill's fault? 🤖 Claude Code

Ben opens **Claude Code** at the **repo root** on the branch, and they check the
project's `results/` files — the actual data the tools returned. The census tool
**did** return the page/line and the skill dropped it → a **skill** problem.
Continue. ✅

Had the tool never returned it, that would be a tool problem and an engineering
ticket, not a skill edit — stage 5's lane rule. Skipping this check is the
classic trap.

### Step 3 — Capture it as a test 🤖 Claude Code

In the same session, Ben runs **`mine-unit-test`**, points it at Ana's project
folder, and pastes her Did/Should/Gap note:

```
/mine-unit-test --project eval/e2e-project/schuster-census
```

It writes a unit test that reproduces the bug — "given a census record that has
a page/line, the citation must include it" — plus a scenario and mock fixtures,
all marked *draft* under `eval/tests/unit/citation/` and `eval/fixtures/`. Ben
skims it and checks that the **general** rule is what's stated, not "this one
Schuster record."

It prints the new test's id — say `ut_citation_019`. That's the `TEST=` value
for Step 6.

### Step 4 — Run it, and mark what's wrong ⌨️ Terminal → 🌐 browser

`citation` already has its hold-out tests set (`ut_citation_001` and
`ut_citation_014`), so Ben goes straight to the run — a brand-new skill would
need them set in the UI first, *before* this run.

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
make eval-ui                                 # Windows: eval\Start.bat
```

He finds the new test in the grading UI, sees which quality dimension it failed,
and pastes **Ana's Did/Should/Gap note** into that dimension's comment. The
improver in the next step will do nothing with a brand-new test *unless* it
carries a human comment like this.

### Step 5 — Audit, then improve 🤖 Claude Code

```
/audit-rubric citation
/improve-skill citation
```

The first is a health check on the grading itself — do it once per skill so
you're not chasing a broken grade. The second reads the test + Ana's comment and
proposes **at most 3** small, plain-English edits — e.g. *"every citation must
include a locator (page/line/entry) that lets a reader reopen the exact record;
if the record has none, write a 'missing locator' marker instead."* The agent
only **proposes**; Ben pastes the edits into `citation/SKILL.md` himself.

### Step 6 — Check the fix helps and breaks nothing ⌨️ Terminal

```
make gate-skill SKILL=citation TEST=ut_citation_019   # Windows: eval\GateSkill.bat
```

**LOOKS GOOD** → go do the release run. **NEEDS YOUR EYES** → adjust the edit
and re-run; don't open the PR yet. **INCONCLUSIVE** → re-run once; if it stays
inconclusive, go back to Step 3 for a sharper test.

### Step 7 — Confirm it in Cowork 🖥️ Cowork + Viewer

Rebuild and re-upload the plugin first so Cowork runs the *edited* skill:
`make plugin` (Windows: `eval\BuildPlugin.bat`), then remove the old plugin in
Cowork → Customize and upload the new `.zip`.

Then Ana redoes the same citation, with the **Research Viewer** open on the same
project folder. The viewer is the point here, not a nicety: the fix is a
*citation string in the research log*, and reading it there is how you confirm
the page/line is actually present rather than trusting the chat's summary of
what it wrote.

This is the real-world sanity check; the unit test from Step 3 is the durable
guard that stops the bug from ever coming back.

### Step 8 — Release run and PR ⌨️ Terminal → 🌐 browser / GitHub

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
make eval-ui                                 # Windows: eval\Start.bat
```

Grade every dimension (**Agree with all**, then correct the few he disagrees
with), then commit the skill edit + the new test *and its scenario folder and
mock fixtures* + the run record + the grades, and open the PR. A senior reviewer
reads the corrected grades and, if it's a real improvement, releases it.

### Cheat sheet: where each step happens

| Step | What you do | Where |
|---|---|---|
| 0 Branch | `git checkout -b <branch>` | ⌨️ Terminal |
| 1 Notice | research; spot the problem; write Did/Should/Gap | 🖥️ Cowork + Viewer |
| 2 Classify | skill's fault, or a tool/grading fault? | 🤖 Claude Code |
| 3 Capture | `/mine-unit-test --project <dir>` | 🤖 Claude Code |
| 4 Run + mark | run the tests; paste the note on the failing dimension | ⌨️ Terminal → 🌐 browser |
| 5 Audit + improve | `/audit-rubric`, then `/improve-skill`; you apply the edits | 🤖 Claude Code |
| 6 Gate | check the fix helps and breaks nothing | ⌨️ Terminal |
| 7 Verify | rebuild + re-upload the plugin; redo the research; see it fixed | 🖥️ Cowork + Viewer |
| 8 Release + PR | full run, grade every dimension, submit | ⌨️ Terminal → 🌐 browser / GitHub |

### Windows equivalents

Every `make` target above has a batch file. Double-click it, or run it from
`eval\`; each prompts for what it needs instead of taking `SKILL=`-style
arguments, and rebuilds the MCP server first where that matters.

| Instead of | Double-click |
|---|---|
| `make e2e-project TEST=<slug>` | `eval\SeedProject.bat` |
| `make eval-skill SKILL=<skill>` | `eval\RunTests.bat` |
| `make eval-ui` | `eval\Start.bat` |
| `make gate-skill SKILL=… TEST=…` | `eval\GateSkill.bat` |
| `make optimize-skill SKILL=<skill>` | `eval\OptimizeSkill.bat` |
| `make electron` | `eval\Viewer.bat` |
| `make e2e-login` | `eval\Login.bat` |
| `make plugin` / `make mcpb` | `eval\BuildPlugin.bat` / `eval\BuildMcpb.bat` |
| `git checkout -b <branch>` | GitHub Desktop → Current Branch → **New branch…** |

The `/`-commands (`/mine-unit-test`, `/audit-rubric`, `/improve-skill`) are
typed into Claude Code and are the same on every platform.

---

## Doc index

Everyday docs:

| You want to… | Go to |
|---|---|
| Write a SKILL.md well | [`docs/skill-authoring-guide.md`](skill-authoring-guide.md) |
| Run the harness / read a run-log | [`eval/README.md`](../eval/README.md) |
| Audit a skill's rubric quality | `/audit-rubric <name>` — the `rubric-critic` agent |
| Improve a SKILL.md body from eval results | `/improve-skill <name>` — the `skill-improver` agent |
| Author and run an e2e benchmark fixture | [`docs/e2e-testing-guide.md`](e2e-testing-guide.md) |
| Triage an alpha tester's feedback zip | [`docs/alpha-feedback-guide.md`](alpha-feedback-guide.md) |
| Do your first PR (genealogist / senior) | [`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md), [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md) |

**Go deeper only if you're changing the machinery itself** — you don't need
these to follow the flow above:

| Topic | Spec / plan |
|---|---|
| Skill architecture & the three skill kinds | [`docs/specs/skill-architecture-spec.md`](specs/skill-architecture-spec.md) |
| Test JSON format, fixtures, validators | [`docs/specs/unit-test-spec.md`](specs/unit-test-spec.md) |
| Per-PR review + run-log release/active/candidate mechanics | [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md), [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md) |
| The vendored description optimizer | `eval/triggering/` (vendoring notes in `VENDORED.md`) |
| The e2e fixture format and judge contract | [`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md) |
| The feedback-case contract (baseline, marker file, lints) | [`docs/specs/feedback-case-spec.md`](specs/feedback-case-spec.md) |
