# The skill lifecycle — authoring, testing, and improving genealogy skills

This is the **start-here map** for the people who build and improve the
genealogy skills: how a skill problem goes from a real failure to a tested,
committed fix. It is the **complete flow** end to end and the entry point; it
points at the detailed docs for each step rather than restating them.

You drive the whole loop — capture the test, run the harness, correct the
grades, improve the skill, and open the PR. No step belongs to someone else.
When a step needs a genealogy judgment you're unsure of, or a bit of harness
mechanics you haven't hit before, pull in a teammate for a second pair of
eyes — but the loop is yours end to end.

```
  0 branch → 1 start from a failure → 2 whose fault? → 3 capture a test →
       4 run + grade (baseline) → 5 improve → 6 verify → 7 confirm in Cowork →
       8 re-run + grade + PR

  One skill at a time. Most work starts at step 1 with an alpha-feedback zip
  or a failed e2e run. Step 5 routes each finding to the right lane — only a
  body-located cause ever becomes SKILL.md prose.
```

If you're brand new, read the two walkthroughs first:
[`eval/JUNIOR-WALKTHROUGH.md`](../eval/JUNIOR-WALKTHROUGH.md) (genealogist)
and [`eval/SENIOR-WALKTHROUGH.md`](../eval/SENIOR-WALKTHROUGH.md).

Two things are **not** in this numbered loop because they're not the common
path: authoring a brand-new skill, and tuning a skill's description. Both have
their own short sections after step 8.

## Where each step happens

Every step below opens with a **Where / How** line. There are only three
places, and each command has both a `make` form and a Windows double-click
form — use whichever your machine has:

| Icon | Place | What it is | How you run things there |
|---|---|---|---|
| ⌨️ | **Terminal** | A shell at the repo root (macOS/Linux) — or File Explorer on Windows, where you double-click a `.bat` in `eval\`. | `make <target>` — Windows: double-click `eval\<Name>.bat`, which prompts for the skill or test name instead of taking `SKILL=`/`TEST=` arguments. |
| 🤖 | **Claude Code** | The **Code tab** of the Claude desktop app, opened on the repo root — or `claude` in a terminal at the repo root. Either works; the Code tab is the usual Windows path. **Not** Cowork. This is where the repo-local dev skills and agents live. | Type the slash command, e.g. `/improve-skill citation`. |
| 🖥️ | **Cowork** | The real product, running the plugin + MCP extension you installed into Claude Desktop. | Only for trying a skill by hand in the shipping product — see "Rebuilding and reinstalling" below, which is not optional. |

Rule of thumb: **Claude Code = you ask Claude to do something. Terminal = you
run a command yourself. Cowork = you do genealogy.**

Two more surfaces show up alongside those three. The **grading UI** (step 4) is
a 🌐 browser tab that `make eval-ui` opens. The **Research Viewer** (Electron,
`make electron`) renders the research log, assertions, conflicts and sources of
whichever project folder you point it at — it's how you *see* what the agent
wrote rather than trusting the chat's summary of itself, so open it whenever
you open a project in Cowork.

**Everything happens in one checkout, on one branch.** `make eval-skill` and
`make gate-skill` test the working tree, so that's where your skill edit has to
be; Claude Code opens at the same repo root, because `mine-unit-test` writes
into `eval/` relative to where you started it. The one exception is the
**project folder you research in** — a seeded scratch project under
`eval/e2e-project/<slug>/`, or an unpacked feedback case under
`~/feedback/<slug>/`. Those are research data, not repo source.

The `.bat` files live in `eval\` and are listed in
[`eval/README.md`](../eval/README.md). Windows users never need `make`, and
macOS/Linux users never need the `.bat` files — every step is available both
ways.

### Rebuilding and reinstalling

Three different surfaces, three different rules. Getting this wrong is the
single most common way to spend an hour testing a fix that was never loaded.

| You changed… | Claude Code / the harness | Cowork |
|---|---|---|
| **A skill** (`SKILL.md`, templates, references) | Nothing. The harness reads your working tree directly. | Rebuild the plugin and re-upload it. |
| **Tool code** (`packages/engine/mcp-server/src/**`) | Rebuild the engine, then start a **fresh** Claude Code session. | Rebuild and reinstall the `.mcpb`. |

**Claude Code needs no install.** The repo root has a `.mcp.json` that already
points Claude Code at the built engine, so the genealogy tools are wired
automatically — the Code tab and the `claude` CLI both read it. Two things to
know: Claude Code prompts **once** to approve the project MCP server (approve
it, or you have no genealogy tools), and after a tool-code change you rebuild
with `make engine-build` (Windows: `eval\BuildMcpb.bat`, which also compiles)
and start a new session so it picks up the new build. `make eval-skill` and
`eval\RunTests.bat` rebuild automatically when the engine is stale.

**Cowork needs both artifacts installed into Claude Desktop**, and you redo
whichever one changed:

```bash
make plugin        # Windows: eval\BuildPlugin.bat   — if you changed a skill
make mcpb          # Windows: eval\BuildMcpb.bat     — if you changed tool code
```

- **Plugin:** Claude Desktop → **Cowork tab** → Customize → **remove the old
  Genealogy Research plugin first**, then Add → Upload Plugin → the new `.zip`.
  Upload from the Cowork tab, not the Code tab — they keep separate plugin
  lists.
- **MCP:** Claude Desktop → Settings → Extensions → Advanced Settings →
  Install extension → the new `.mcpb`. It installs straight over the old copy.

Then **fully quit and reopen Claude Desktop.** Cowork runs the uploaded `.zip`,
not your working tree — skip the rebuild and your fix will look like it did
nothing.

---

## The steps

### 0. Make a branch

**Where:** ⌨️ terminal, or GitHub Desktop. **How:**

One task, one branch, always cut from an up-to-date `main` — you open a PR from
it at the end.

**Terminal:**

```bash
git checkout main && git pull
git checkout -b <short-task-name>          # e.g. citation-locator
```

**GitHub Desktop:** Current Branch dropdown → select **main** and
**Fetch/Pull** → **New branch…** → name it `<short-task-name>` (e.g.
`citation-locator`) → base it on `main` → **Create branch**.

Name the branch with a few hyphenated words describing the task — no slashes,
no timestamps.

Do this **first**, before you touch a file — and specifically before you seed a
project or unpack a feedback case. Both setup paths stamp your checkout *as it
is when you run them*, and the test you mine later lands on whatever branch is
checked out then. Unpack a case while still on `main` and your test ends up on
`main`.

Everything the rest of the loop produces — the SKILL.md edit, new tests, the
run log, your grading corrections — is committed together on this one branch.
Pushes to `main` are blocked, so starting on `main` just means moving the work
later.

### 1. Start from a real failure

**Where:** depends which door you came through — see below. **How:**

Skills get improved because something went wrong. There are three ways a
problem reaches you, and **the first two are the norm** — most skill
improvements start life as an alpha tester's report or a failed benchmark run.

Whichever door you came through, you leave this step with the same two things:
a plain-English **Did / Should / Gap** note, and the **`results/` files** — the
actual tool responses, which step 2 needs.

> **Did:** what the skill actually did.
> **Should:** what it should have done.
> **Gap:** which SKILL.md guidance is missing, wrong, or being ignored.

#### (a) An alpha tester sent a feedback zip 🤖 Claude Code (case folder)

The common case. Unpack the case from ⌨️ the repo root, then reproduce the bug
by replaying the tester's **exact** prompt:

```bash
make feedback-case ZIP=~/Downloads/feedback-<timestamp>.zip
# Windows: scripts\setup-feedback-case.bat <zip path>
```

Open the resulting `~/feedback/<slug>/` folder in Claude Code (**not** the
repo — the case folder *is* the research project, with the skills linked in),
paste the prompt the setup script printed, and watch it with the Research
Viewer open. The tester's Did/Should is already written down for you in
`_feedback/feedback.json`.

Between attempts, reset **both** halves — the data and the conversation:

```bash
make feedback-reset CASE=~/feedback/<slug>
# Windows: scripts\reset-feedback-case.bat <case folder>
```

then `/clear` so Claude isn't reading its own earlier bad reasoning. Full
walkthrough: [`alpha-feedback-guide.md`](alpha-feedback-guide.md).

#### (b) An e2e benchmark run missed a finding ⌨️ Terminal → 🤖 Claude Code

The other common case. You already have the run log — it *is* the evidence, so
there's nothing to reproduce. Read what happened, then carry the finding
forward:

```
/interpret-e2e-result
```

To poke at it by hand, seed an editable project from the fixture and research
it yourself (this is 🖥️ Cowork, so reinstall first):

```bash
make e2e-project TEST=<slug>        # Windows: eval\SeedProject.bat
```

Full walkthrough: [`e2e-testing-guide.md`](e2e-testing-guide.md).

#### (c) You noticed it in your own Cowork session 🖥️ Cowork + Viewer

You were researching and saw the agent do something wrong. Write the
Did/Should/Gap note **while you still remember it** — that note is the most
valuable thing you produce all day. Your project folder already has the
`results/` files step 2 needs. Appendix B walks this door end to end.

### 2. Whose fault is it?

**Where:** 🤖 Claude Code, on the project or case folder. **How:** read the
`results/` files — the actual data the tools returned.

This is the question to answer *before* you touch any prose, and it takes two
minutes:

- The tool **returned** the data and the skill dropped or misused it → a
  **skill** problem. Continue to step 3. ✅
- The tool **never returned** it → a **tool** problem. Different fix, an
  engineering ticket, not a prose edit. Stop here.
- The skill did the right thing and the test or rubric marked it wrong → a
  **grading** problem. That's yours to fix too — jump to step 5's lane 2.

Skipping this check is the classic trap: rewriting a skill's instructions for a
bug that actually lives in a tool. Step 5 has the full four-lane version for
once you've seen the grades; this is the cheap version that stops you wasting
the next hour.

### 3. Capture it as a test

**Where:** 🤖 Claude Code at the repo root. **How:**

```
/mine-unit-test                            # asks what it needs
/mine-unit-test --project <dir>            # a research project or feedback case folder
/mine-unit-test --e2e-run <dir>            # a recorded e2e run that missed a finding
/mine-unit-test --skill <name>             # skip the "which sub-skill?" question
```

It writes a draft test, a scenario carved from the mid-flow state the sub-skill
actually saw, and mock fixtures built from the saved tool responses — all under
`eval/tests/unit/<skill>/` and `eval/fixtures/`.

Skim the draft and check **one thing above all: the test must state the general
rule**, not the specific case. "Any census record with a page/line must include
it" is a test; "this one Schuster record" is a fake win that turns green
without the skill getting better. (The scenario carve is the part most worth a
second look.)

It prints the new test's **id** — `ut_<skill>_<xxx>`, where `<xxx>` is a random
three-character suffix, e.g. `ut_citation_k3f`. It's random rather than
sequential so two people adding a test to the same skill at once can't collide.
That id is the `TEST=` value for step 6. (Older tests have numeric ids like
`ut_citation_019`; those stay as they are.)

> **Capture the test before you fix the bug.** Step 6 proves your fix worked by
> comparing against a run from *before* you edited anything. If you mine the
> test after the fix has landed, the bug no longer reproduces on the un-edited
> skill, the gate comes back `INCONCLUSIVE`, and nothing is proven either way.

> **First time improving this skill? You'll need hold-out tests.** Read the
> hold-out note in step 4 now — they have to be set *before* the run you're
> about to do, and setting them afterwards invalidates it.

How to author a *good* test corpus is [Appendix A](#appendix-a-authoring-a-test-corpus) —
it's the single biggest lever on whether the rest of the loop works.

### 4. Run it and grade it — the baseline

**Where:** ⌨️ terminal, then 🌐 the grading UI in your browser. **How:**

```bash
make eval-skill SKILL=<skill>     # rebuilds the engine if stale, then runs
make eval-ui                      # then open http://localhost:3000
```

**Windows:** double-click `eval\RunTests.bat` (it rebuilds the MCP server, then
asks which skill), then `eval\Start.bat` to open the grading UI. Leave that
window open while you work; closing it stops the app.

The harness drives the skill against mocked tool responses in a seeded starting
state, an LLM judge grades each run, and it saves a **run log** — the scores
plus a snapshot of the exact skill, tests, scenario and fixtures used, so the
run can be reproduced. Tests are **slow (~2–3 min each) and cost money** — scope
every run to one skill, and never run several at once (they fight for memory
and get killed).

**You will run these same two commands again in step 8 — that's not a
duplicate.** This run records how the skill behaves *before* your edit, which is
the only thing your fix can be measured against. Steps 5 and 6 both depend on it
being fully graded: the improver reads your corrections to decide what to
change, and the gate compares your fix against them. Grade it now and the rest
of the loop works; leave it ungraded and step 5 proposes nothing while step 6
has nothing to compare to.

> **Hold-out tests — set them before your first run of a skill.** A hold-out is
> just a test you hide from the improver in step 5, so it can catch a "fix"
> that only games the tests it was shown. Pick **2–3** varied, stable tests,
> open each in the grading UI, and flip the **"Hold out from the
> skill-improver"** switch on. Leave them set.
>
> Why it matters: step 6's gate re-runs your hold-outs to check nothing broke.
> **If the skill has no hold-outs, that check silently does nothing** and a
> "LOOKS GOOD" means less than it looks. Setting or changing a hold-out also
> changes how the run is graded, so doing it *after* a run invalidates that
> run — if you've already run, set them and run again.

Now read each run and correct the judge. The UI pre-fills every dimension with
the judge's score, so there are two separate things to do:

- **Change the score** only on dimensions you actually **disagree** with.
- **Write a comment on every dimension that isn't passing** — whether or not
  you agree with the score.

That second one is the part people skip, and it's what makes the difference in
step 5. The improver only proposes a body edit when a problem either recurs
across two or more tests *or* carries a human comment naming the gap. A failing
dimension with no comment is something it merely **reports**; a failing
dimension *with* your comment is something it can actually fix.

**Write comments a machine can act on.** "Judge over-credited" is useless. Use
the same three parts you wrote in step 1:

> **Did:** what the skill actually did.
> **Should:** what it should have done.
> **Gap:** which SKILL.md guidance is missing, wrong, or being ignored.

Example: *"Did: labeled the conflicting birthplaces a soft conflict. Should: a
hard conflict — two primary informants disagree. Gap: the skill body never says
primary-vs-primary disagreement is hard."* That comment points straight at the
fix; the "judge over-credited" version doesn't.

If you arrived from a real failure you already wrote this note in step 1 — this
is where it goes on the record.

### 5. Improve the skill

**Where:** 🤖 Claude Code at the repo root. **How:**

```
/audit-rubric <skill>
/improve-skill <skill>
```

Run the rubric audit first — it's a health check on the *grading*, so you're
not chasing a score that was wrong to begin with. The **rubric-critic** agent
reads the skill's run logs, your corrections and its `rubric.md`, and flags
dimensions that never discriminate (always pass or always fail), flaky ones,
and ones no test exercises. Then **skill-improver** reads the annotated run log
and proposes an evidence-cited diff. Both are read-only: they propose, **you**
apply the edits.

#### The lane rule — classify every finding before touching skill prose

Most findings are *not* skill-prose problems. A 2026-07 audit found most of a
month's SKILL.md edits were tool bugs or grading bugs wearing skill-prose
clothing — people patched a 780-line prompt because it was the only lever they
held. Place every finding first:

1. **Tool defect** (rejected valid payloads, missing capability, silent
   corruption) → an MCP tool fix + test. Prose never compensates for a tool bug.
2. **Grading defect** (the skill did the right thing and got dinged) → fix the
   grading, not the skill. **This is yours** — see below.
3. **Record-type craft gap** (a death-certificate, probate or church-record
   nuance) → that record type's reference document, not new global prose. These
   live in the skill's own `references/` directory (e.g.
   `citation/references/gps-citation-standards.md`), which the skill loads on
   demand — keeping the main body short.
4. **Core doctrine** (a genuine cross-record-type behavior change) → a
   SKILL.md edit, gated by the unit suite.

Lanes 1–3 merge conflict-free and in parallel; only lane 4 touches the
contended prompt. When you're torn between 2 and 4, check the transcript: if
the skill *followed* its written instruction and still got marked wrong, it's
lane 2. `/improve-skill` does this routing too — it will hand a finding back as
a test-data, fixture or grading problem rather than inventing prose for it.

#### What you own in lane 2

Four different things feed a grade, and only two of them are yours:

| Thing | Where | Yours? |
|---|---|---|
| **This test's expectations** | `judge_context` in the test JSON | **Yes** — fix it |
| **This skill's rubric** | `eval/tests/unit/<skill>/rubric.md` | **Yes** — fix it |
| Base rubric (every skill) | shared | No — Dallan's |
| Global judge prompt | `eval/harness/judge/prompt.md` | No — Dallan's |

If the grading problem is in the first two, **just fix it** — that's the whole
point of lane 2. One catch: both are part of the run-log snapshot, so editing
either makes your latest run stale and you have to **re-run the skill's suite**
(CI blocks otherwise). Do the edit before your final run in step 8, not after.

If the problem is in the bottom two, don't touch them — they're global, and a
change re-baselines every skill in the project. Post the problem and your
proposed wording in Slack and let Dallan make the call.

#### When it is a body edit

Cluster the failures across the skill's tests and revise the prose to explain
the *why* rather than bolting on another MUST. `/improve-skill` proposes **at
most 3** edits per round. The discipline:

- **Generalize, don't patch the case.** The test is the question, not the
  answer key. An edit that only helps one scenario is a regression in disguise.
- **Leave the hold-outs alone.** They exist to check the edit helped cases it
  wasn't written from. Don't rewrite one to make it pass.
- **Trust your comment over the judge.** Where they disagree, your comment
  governs the edit.
- **Subtract, too.** If a run shows the skill sending the model down
  unproductive paths, delete the offending instruction. Net length should trend
  flat or down.

### 6. Verify the fix

**Where:** ⌨️ terminal at the repo root. **How:** apply the edits **first**,
then:

```bash
make gate-skill SKILL=<skill> TEST=<test-id>
```

**Windows:** double-click `eval\GateSkill.bat` — it asks for the skill and the
test id.

The gate re-runs just the test you mined plus the skill's hold-outs, and
compares them against **your corrected grades** from step 4 — human judgment,
not judge-versus-judge. It's fast and cheap, so iterate here rather than
re-running the whole suite. It prints one of:

- **LOOKS GOOD** — the failing dimension passes and nothing else broke.
- **NEEDS YOUR EYES** — the fix didn't land, or a hold-out got worse. Read the
  table, adjust your edit, run it again. Don't open the PR yet.
- **INCONCLUSIVE** — the bug never showed up on the *old* skill, so nothing was
  proven either way. Usually the test is too weak. Grading isn't perfectly
  repeatable, so run it once more before going back to step 3 for a sharper
  test.

Two things to keep in mind. **One run is enough here** — a real problem fails
consistently, and a single run shows that. Small score wobbles between runs are
noise, not progress. And **judge the named problem, not the average**: the
question is "does the dimension that was failing now pass, without anything
obvious breaking?" — not "did the overall score go up."

The gate deliberately writes **no run log**, which is why it's cheap enough to
iterate on — and why step 8 still has a full run in it.

### 7. Confirm it in Cowork

**Required** if you came through the alpha-feedback door (step 1a) — optional,
but cheap insurance, for the other two.

**Where:** 🖥️ Cowork + the Research Viewer. **How:** rebuild and reinstall
first — see [Rebuilding and reinstalling](#rebuilding-and-reinstalling). Cowork
runs the uploaded plugin, not your working tree.

Steps 4 and 6 proved the fix against *mocked* data. This proves it the way a
user actually gets it. Redo the research that failed in step 1, with the
Research Viewer open on the project folder — the fix usually shows up as
something written into the research log or the assertions pane, which is not
something the chat's summary of itself will tell you honestly.

Coming from the alpha-feedback door, re-unzip the **original** zip into a fresh
folder so Cowork sees the pristine user state, and re-issue the tester's exact
prompt. If the fix holds in the harness but *not* in Cowork, the bug
may be Cowork-specific — plugin loading, viewer context, OS file handling — so
get help diagnosing it and **do not ship the PR**.

### 8. Re-run, grade, commit, and PR

**Where:** ⌨️ terminal, 🌐 the grading UI, then GitHub. **How:**

The gate in step 6 wrote no run log, and your edits changed the skill
underneath the step-4 run — so do one full run against the edited skill and
grade it:

```bash
make eval-skill SKILL=<skill>          # Windows: eval\RunTests.bat
make eval-ui                           # Windows: eval\Start.bat
```

Grade it: click **Agree with all**, then correct the few dimensions you
actually disagree with. **Every dimension has to be reviewed** — CI fails on a
partly-graded run.

Then commit everything together — the skill edit, the new test *and its
scenario folder and mock fixtures* (commit only the test JSON and it can't
run), the run log and its `.ann.json`:

**Terminal:**

```bash
git add packages/engine/plugin/skills/<skill>/ eval/tests/unit/<skill>/ \
        eval/fixtures/scenarios/<slug>/ eval/fixtures/mcp/ \
        eval/runlogs/unit/<skill>/
git commit -m "<skill>: <what changed and why>"
git push -u origin <your-branch>
gh pr create                            # or open the PR from GitHub's web UI
```

**GitHub Desktop:** make sure the repository picker says **cowork-genealogy**,
tick the paths above, type a summary in the Summary box, **Commit to
`<your-branch>`**, then **Push origin** and **Create Pull Request** (it opens
GitHub in your browser with the branch pre-filled).

The commit message *is* the lesson — explain what went wrong and what changed.
There's no separate lesson file by design.

A senior genealogist reviews the PR — the diff plus your corrected grades — and
merges it. They leave feedback as **PR comments**; respond by re-running and
pushing a *new commit per round* (don't amend). Most PRs land in 1–2 rounds;
3+ is a signal to ask for help rather than grind.

**What CI checks.** The `check-runlogs` gate is blocking and enforces two
things your step-4 run can no longer satisfy, because the skill changed
underneath it:

- The latest run log per touched skill must be **active** — its snapshot still
  matching the branch's current skill files, tests and rubric. Edit any of
  those and the UI shows "no active version" until you re-run; that's your
  signal the results are stale.
- Its `.ann.json` must carry a correction for **every** (test, dimension) pair.

**One *problem* per PR — which is usually, but not always, one skill.** A
locator rule that belongs in `citation` alone is a one-skill PR. But a doctrine
change about how evidence is classified may have to land in `person-evidence`,
`conflict-resolution` and `proof-conclusion` together, because shipping it in
one and not the others leaves the skills contradicting each other mid-research.
When that happens, edit them all in the same PR — and run `make eval-skill` for
**each** touched skill, since the gate checks every skill the PR touches. What
you should not do is bundle two *unrelated* fixes because they happened to
share a branch.

---

## Side loop: authoring a brand-new skill

**Where:** 🤖 Claude Code at the repo root (or any text editor — the skill is
just `packages/engine/plugin/skills/<skill>/SKILL.md`).

Occasionally you're not fixing a skill but creating one. For a new
tool-wrapping skill, ask Claude Code to scaffold it with the
`cowork-skill-builder` agent; otherwise write the file directly, to the prose
standard in [`docs/skill-authoring-guide.md`](skill-authoring-guide.md). (That
guide's "What kind of skill are you writing?" section covers whether it should
be a skill at all, and which of the three kinds — workflow, reference, or
guardrail — it is.) You drive the domain content, the shape, the frontmatter
limits, and any `scripts/` helper, pulling in help when a piece is outside your
comfort zone.

Then rejoin the loop at **step 3**: it needs a test corpus
([Appendix A](#appendix-a-authoring-a-test-corpus)) and hold-outs before it can
be improved like any other skill.

## Side loop: tuning a skill's description

**Where:** ⌨️ terminal at the repo root. **How:**

```bash
make optimize-skill SKILL=<skill>      # Windows: eval\OptimizeSkill.bat
```

A skill has two parts that are tuned separately. The one-line **description**
controls *when* the skill fires; the **body** (the loop above) teaches Claude
*how* to do the task. A *triggering* problem — the skill fires when it
shouldn't, or doesn't when it should — is a **description** fix. An "it did the
task wrong" problem is a **body** fix. Don't conflate them.

The optimizer builds should-trigger / should-not-trigger query sets from your
positive and negative tests, then tunes the description against them. It never
runs the skill or a tool. Apply the proposed description as a human-reviewed
SKILL.md edit; its report lands in `eval/runlogs/optimizer/`, separate from
your test run logs. It makes real API calls, so it costs money and is **not**
in CI.

**Sequence the two loops.** Fix the body first — a skill that never fires can't
be body-improved. After a body change that alters *what the skill does*, re-run
the optimizer. After a description change, re-run the skill's tests to confirm
its behavior didn't move.

---

## Is the loop working?

The real metric isn't pass rate — it's whether the system **compounds.** When
you catch the *same kind of mistake* across several tests, stop fixing it by
hand: push it down into something that catches it automatically. A yes/no check
on a single output (e.g. "citation missing") becomes an automated test;
something you only see by reading the whole output and weighing it (e.g.
"overconfident conclusion") becomes a **rubric** dimension. If you're still
hand-catching the same class of issue ten rounds in, the loop isn't learning.

## Command card

| Step | Where | macOS / Linux | Windows |
|---|---|---|---|
| 0 Branch | ⌨️ terminal | `git checkout -b <short-task-name>` | GitHub Desktop → New branch… |
| 1 Start from a failure | 🤖 / ⌨️ / 🖥️ | `make feedback-case ZIP=…` · `/interpret-e2e-result` · `make e2e-project TEST=…` | `scripts\setup-feedback-case.bat` · `eval\SeedProject.bat` |
| 2 Whose fault? | 🤖 Claude Code | read the project's `results/` files | same |
| 3 Capture | 🤖 Claude Code | `/mine-unit-test [--project \| --e2e-run <dir>]` | same |
| 4 Run + grade *(baseline)* | ⌨️ terminal → 🌐 browser | `make eval-skill SKILL=<name>`, `make eval-ui` | `eval\RunTests.bat`, `eval\Start.bat` |
| 5 Improve | 🤖 Claude Code | `/audit-rubric <name>`, `/improve-skill <name>` | same |
| 6 Verify | ⌨️ terminal | `make gate-skill SKILL=<name> TEST=<id>` | `eval\GateSkill.bat` |
| 7 Confirm in Cowork | 🖥️ Cowork | `make plugin`, `make mcpb`, then reinstall | `eval\BuildPlugin.bat`, `eval\BuildMcpb.bat` |
| 8 Re-run + grade + PR | ⌨️ terminal → 🌐 → GitHub | `make eval-skill`, grade all, commit, PR | `eval\RunTests.bat`, then GitHub Desktop |
| *(side)* new skill | 🤖 Claude Code | the authoring guide + `cowork-skill-builder` | same |
| *(side)* description | ⌨️ terminal | `make optimize-skill SKILL=<name>` | `eval\OptimizeSkill.bat` |

**To run the improver on skill `X`:** it needs an *active*, *annotated* run
log. So run the harness on current code (`make eval-skill SKILL=X`), grade it
in the UI, then type `/improve-skill X`. Against a stale or ungraded run log it
proposes nothing and asks you to re-run — that's correct, not a failure.

**Type the slash commands rather than asking in prose.** Both agents are
read-only by construction — they propose, you apply. Phrasing it as a request
relies on description matching, and a miss doesn't fail loudly: you get
ordinary Claude, which *does* have Edit and Write, doing the job instead, and
the 3-edit budget and the you-apply-them gate quietly disappear. The commands
also check you're at the repo root and warn when hold-outs or grades are
missing.

---

## Appendix A: Authoring a test corpus

Referenced from step 3 — this is how to build the corpus the whole loop grades
against, and it's the single biggest lever on whether any of the rest works.

A test is four things you fill in the grading UI — no JSON: the **user
message**, a starting **scenario** (project state) from a dropdown, optional
**fixtures** (canned tool responses so the skill doesn't hit a live API), and
plain-English **expectations**. You can ship a useful test with just a message
and a scenario — the skill's shared rubric does the heavy grading; your
expectations only add what's unique to *this* case. (If no scenario fits, pick
the closest and note the gap — the test saves but won't run until the matching
scenario is built.)

Aim for **at least 8 tests per skill** — no upper bound. Spend them on
**coverage, not repetition**: eight easy happy-path tests can't tell a good
skill from a bad one. Each skill's set should span:

- **Positive** — the skill should fire and do the task well (happy path *and*
  messier variants).
- **Negative / routing** — a near-miss that should go to a *different* skill
  (you name which one, or "none"). Mine these from the "Do NOT use when…"
  clauses in the description; build them from both directions of each
  confusable pair.
- **Edge cases** — the messy genealogy realities: conflicting records, missing
  data, ambiguous places, multi-person households.
- **At least one hard case** — something the skill currently gets wrong. A
  corpus with no failures has nothing to improve against.

Then mark **2–3 diverse, representative tests as hold-outs** up front (step 4).
Authoring the hold-out into the corpus now is far cheaper than carving it out
after the improver has already been run against everything.

Keep your expectations **neutral** — grade the *reasoning*, never a preferred
answer. "Should resolve in favor of the Irish birthplace" is leakage: the judge
then just agrees with you. Rewrite it to "resolution should weigh informant
proximity as a factor, regardless of which birthplace it picks." The test:
would a genealogist who reached the *opposite* conclusion still call your
expectation fair? If not, it's leaking — the biggest threat to the validity of
LLM grading.

---

## Appendix B: Worked example — a citation nobody could find again

One run through steps 0–8, start to finish, for the "you noticed it yourself"
door. The step numbers here are the same step numbers as above.

> **The story follows one person — "you" — running the whole loop**, which is
> the normal case; **pull in a teammate for any step you're not comfortable
> with.** The Schuster family and the `schuster-census` slug are invented; for
> a real run, use an existing fixture slug from `eval/tests/e2e/`.

> **Before you start (one-time setup).** Two things gate this loop; skip them
> and the steps below silently do nothing.
> - **Cowork steps (1 and 7)** need the genealogy tools installed *into
>   Cowork*: log in to FamilySearch (`make e2e-login` / `eval\Login.bat`, once
>   a day), then build and install both artifacts per
>   [Rebuilding and reinstalling](#rebuilding-and-reinstalling). Plain
>   `make engine-build` wires only the Claude Code side — in Cowork the project
>   would open with no tools and there'd be nothing to notice or confirm.
> - **Grading steps (4 and 8)** call the LLM judge, which needs an Anthropic
>   API key in `eval/.env` (`ANTHROPIC_API_KEY=…`; `Setup.bat` sets this on
>   Windows). Without it every dimension comes back *ungraded*.
>
> The middle steps run on saved mock data, so you don't need to be online.

### Step 0 — Branch ⌨️ Terminal

```
git checkout main && git pull
git checkout -b citation-locator
```

**Windows (GitHub Desktop):** Current Branch dropdown → select **main** and
**Fetch/Pull** → **New branch…** → name it `citation-locator`, base it on
`main` → **Create branch**.

### Step 1 — Start from a real failure: you notice it 🖥️ Cowork + Viewer

You're working in a practice project you seeded earlier from a terminal:

```
make e2e-project TEST=schuster-census        # Windows: eval\SeedProject.bat
```

That writes an editable project into `eval/e2e-project/schuster-census/`. Open
that folder in **two** places: **Cowork**, to do the research, and the
**Research Viewer**, to watch what gets written — launched from a *second*
terminal and left running:

```
make electron                                # Windows: eval\Viewer.bat
```

Then **Open Project** in the viewer and pick the same folder. It live-updates
as the agent works. Skip this and you're judging the research from the chat
transcript alone, which is exactly how a bad citation slips past.

You ask Claude to cite a 1900 U.S. census record you just used. It writes a
tidy-looking citation — but it **leaves out the page and line number**. Without
that, no one could ever open that exact record again. You write down, in plain
words, what's wrong:

> **Did:** the citation gave the census year and county but no page or line.
> **Should:** it must include the page/line so the record can be found again.
> **Gap:** the citation skill never says a citation has to be *relocatable*.

### Step 2 — Whose fault is it? 🤖 Claude Code

Open Claude Code at the **repo root** on your branch and check the project's
`results/` files — the actual data the tools returned. The census tool **did**
return the page/line and the skill dropped it → a **skill** problem.
Continue. ✅

Had the tool never returned it, that would be a tool problem and an engineering
ticket, not a skill edit.

### Step 3 — Capture it as a test 🤖 Claude Code

In the same session, point `mine-unit-test` at the project folder and paste
your note:

```
/mine-unit-test --project eval/e2e-project/schuster-census
```

It writes a unit test that reproduces the bug — "given a census record that has
a page/line, the citation must include it" — plus a scenario and mock fixtures,
all marked *draft*. Skim it and check the **general** rule is what's stated,
not "this one Schuster record."

It prints the new test's id — say `ut_citation_k3f`. That's the `TEST=` value
for Step 6.

### Step 4 — Run it and grade it: the baseline ⌨️ Terminal → 🌐 browser

`citation` already has its hold-out tests set, so you go straight to the run —
a brand-new skill would need them set in the UI first, *before* this run.

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
make eval-ui                                 # Windows: eval\Start.bat
```

Find the new test in the grading UI, see which dimension it failed, and paste
**your Did/Should/Gap note** into that dimension's comment — even though you
agree with the judge that it failed. Without the comment the improver will only
report it, not fix it.

### Step 5 — Improve the skill 🤖 Claude Code

```
/audit-rubric citation
/improve-skill citation
```

The first is a health check on the grading, so you're not chasing a broken
score. The second reads the test + your comment and proposes **at most 3**
small, plain-English edits — e.g. *"every citation must include a locator
(page/line/entry) that lets a reader reopen the exact record; if the record has
none, write a 'missing locator' marker instead."* The agent only **proposes**;
you paste the edits into `citation/SKILL.md` yourself.

### Step 6 — Verify the fix ⌨️ Terminal

```
make gate-skill SKILL=citation TEST=ut_citation_k3f   # Windows: eval\GateSkill.bat
```

**LOOKS GOOD** → go do the final run. **NEEDS YOUR EYES** → adjust the edit and
run again; don't open the PR yet. **INCONCLUSIVE** → run once more; if it stays
inconclusive, go back to Step 3 for a sharper test.

### Step 7 — Confirm it in Cowork 🖥️ Cowork + Viewer

Rebuild the plugin and re-upload it so Cowork runs the *edited* skill (see
[Rebuilding and reinstalling](#rebuilding-and-reinstalling)) — you only changed
a skill here, so the `.mcpb` doesn't need reinstalling. Then redo the same
citation with the Research Viewer open. The viewer is the point, not a nicety:
the fix is a *citation string in the research log*, and reading it there is how
you confirm the page/line is actually present.

### Step 8 — Re-run, grade, commit, and PR ⌨️ Terminal → 🌐 browser / GitHub

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
make eval-ui                                 # Windows: eval\Start.bat
```

Grade every dimension (**Agree with all**, then correct the few you disagree
with), then commit the skill edit + the new test *and its scenario folder and
mock fixtures* + the run log + the grades, and open the PR. A senior
genealogist reads the corrected grades and merges.

---

## Doc index

Everyday docs:

| You want to… | Go to |
|---|---|
| Write a SKILL.md well | [`docs/skill-authoring-guide.md`](skill-authoring-guide.md) |
| Run the harness / read a run log | [`eval/README.md`](../eval/README.md) |
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
| Per-PR review + run-log versioning mechanics | [`docs/plan/per-pr-review-workflow.md`](plan/per-pr-review-workflow.md), [`docs/plan/eval-runlog-versioning.md`](plan/eval-runlog-versioning.md) |
| The vendored description optimizer | `eval/triggering/` (vendoring notes in `VENDORED.md`) |
| The e2e fixture format and judge contract | [`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md) |
| The feedback-case contract (baseline, marker file, lints) | [`docs/specs/feedback-case-spec.md`](specs/feedback-case-spec.md) |
