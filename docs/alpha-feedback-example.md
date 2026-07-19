# From alpha feedback to a fix — a worked example

**Who this is for:** the genealogist + developer pair triaging alpha feedback for
the first time. It follows **one report** end to end and, at every step, says
**which of three places you're working in**. For the terse reference on the
skill-improvement half, see
[`e2e-testing-guide.md` → "From a noticed issue to a fix"](e2e-testing-guide.md#from-a-noticed-issue-to-a-fix-the-skill-improvement-loop).
For what the alpha tester sees, see [`alpha-user-guide.md`](alpha-user-guide.md).

> **The names and the case are invented for the story.** "Marta" (alpha tester)
> and "Sam" (the genealogist + developer pair, collapsed into one person here)
> make it concrete, but the split is illustrative — anyone can do any step, and
> one person can run the whole loop.

---

## The three places

| Icon | Place | What it is | Used for |
|---|---|---|---|
| 🌐 | **The workbench** | <https://genealogy-workbench.fly.dev> in a browser. Where alpha testers research. | *Noticing* the problem and *reporting* it. |
| 🤖 | **Claude Code** | A `claude` session — sometimes in your repo worktree, sometimes in the unpacked case folder. See below. | *Reproducing*, *classifying*, *capturing the test*, *improving the skill*. |
| ⌨️ | **Terminal** | A plain shell for `make …` (Windows: the matching `.bat`). | *Unpacking* the case, *running tests*, *gating*. One `make` target opens a **browser** tab — the grading UI. |

Alpha testers only ever touch the first one. Everything else is us.

Two of the steps below also want the **Research Viewer** (Electron) open, which is
how you read the research log, assertions and conflicts the agent is writing rather
than inferring them from the chat.

### Where to open what

Two directories are in play, and mixing them up is the commonest early mistake:

| | Directory | Why |
|---|---|---|
| **Terminal** (`make …`) | the **worktree root** (Step 0) | `make eval-skill` / `make gate-skill` test the working tree, and that's where your skill edit is |
| **Claude Code**, steps 3–5 | the **case folder** (`~/feedback/<slug>/`) | it *is* the research project; the setup script symlinks the skills in and writes `.feedback-repo-root` pointing back at your checkout, so `mine-unit-test` lands its output in the repo automatically |
| **Claude Code**, step 7 | the **worktree root** | `skill-improver` reads run logs under `eval/runlogs/` |

---

## The story: a parent nobody proved

Marta is working a brick wall — John Schuster, born about 1845 in Augusta County.
The agent finds an 1850 census household headed by a Robert Schuster containing a
5-year-old John, and concludes Robert is John's father. It writes the
relationship into the tree and moves on.

Marta knows the county. There were **two** Robert Schusters there in 1850, and
the census alone can't distinguish them. The agent didn't mention the second one,
didn't look for anything to separate them, and stated the conclusion flatly. It
might even be right — but it hasn't been *shown*, and a wrong parent silently
corrupts everything upstream of it.

### Step 1 — Notice it 🌐 The workbench

Marta clicks **Submit feedback** in the same session and writes:

> **What I asked:** Find John Schuster's parents (b. ~1845, Augusta Co., VA).
>
> **What the agent did:** Concluded from one 1850 census household that Robert
> Schuster was John's father, and wrote it into the tree as settled.
>
> **What it should have done:** Flagged that two Robert Schusters lived in Augusta
> County in 1850, said the census alone can't tell them apart, and either looked
> for something to separate them — probate, land, church records — or recorded it
> as a hypothesis rather than a conclusion.
>
> **The correct answer and its evidence:** *(left blank — see below)*

Marta leaves the fourth box empty, and that's the right call: **the answer isn't
known to be wrong — it's unproven.** That box is for when the agent reached a
*wrong conclusion* and you can supply the right one. Here the defect is the
reasoning, so the third box carries the whole report.

That three-part note is the most valuable thing produced all day. Everything
below is mechanics.

### Step 0 — Branch before you touch anything ⌨️ Terminal

Sam is going to end up editing a skill and writing test files into `eval/`, so the
first move is a worktree — not the main checkout, whatever branch that happens to be
on:

```
make install-hooks                       # once per clone, not once per case
git worktree add .claude/worktrees/schuster-parent -b schuster-parent origin/main
```

`install-hooks` matters: its `post-checkout` hook auto-links the shared gitignored
files (`node_modules`, `eval/.env`, `apps/server/.env`) into each new worktree, so it
can build and run tests immediately.

Do this **before** Step 2, not after: the setup script stamps `.feedback-repo-root`
with whichever checkout you run it from, and that marker is what decides where the
mined test gets written. Run it from the main checkout and your test lands on the
wrong branch.

### Step 2 — Unpack the case ⌨️ Terminal

The bundle lands in the shared Drive folder. Sam downloads it and, **from the
worktree root**, runs:

```
make feedback-case ZIP=~/Downloads/feedback-2026-07-21T09-14-22Z.zip
```

On Windows, `scripts\setup-feedback-case.bat` takes the same zip path as its first
argument. Both wrap the same script; add `FORCE=1` (or `--force`) to overwrite a
case directory you've already unpacked.

That unpacks into `~/feedback/<slug>/` — `research.json`, `tree.gedcomx.json`,
`results/` (the actual tool responses), `_feedback/feedback.json` with Marta's
three answers, and the session transcript. It also symlinks the skills in, `git
init`s the folder, and writes `.feedback-repo-root` back to your worktree — so it's
a working project wired to the right branch, not an archive.

### Step 3 — Continue the research 🤖 Claude Code

**This is the step that replaces guessing.** Sam opens **the case folder**
(`~/feedback/<slug>/`, not the repo) in Claude Code and simply carries on from where
Marta stopped:

```
/research
```

Before typing that, open the **Research Viewer** on the same case folder — from a
terminal in the worktree:

```
make electron                            # Windows: eval\Viewer.bat
```

then **Open Project** → `~/feedback/<slug>/`. The case folder is exactly the shape
the viewer expects, so you get Marta's project rendered as she saw it, and then watch
it change live. For this bug in particular that's the whole game: the defect is *an
unproven relationship written into the tree as settled*, and the viewer shows you
that assertion and its evidence side by side. The chat will just tell you it found
John's father.

The project state *is* Marta's state, so the agent picks up mid-flow and Sam
watches the same reasoning happen live — this time with the ability to interrupt
and ask *"what makes you confident it's that Robert?"* The answer to that
question is usually the defect, stated in the agent's own words.

Sam also reads `_feedback/feedback.json` rather than re-interviewing Marta. Her
Did/Should is already there.

### Step 4 — Whose fault is it? 🤖 Claude Code

Not every report is a skill problem. Using the `results/` files — the real tool
responses — Sam checks:

- Did `record_search` **return** the second Robert Schuster, and the skill ignore
  him? → a **skill** problem. Continue. ✅ *(This is the case.)*
- Did the search **never surface** him? → a **tool** problem. Different fix, an
  engineering ticket, not a prose edit.
- Did the skill behave correctly and a stale rubric would mark it wrong? → a
  **grading** fix.

Skipping this check is the classic trap: rewriting instructions for a bug that
lives in a tool.

### Step 5 — Capture it as a test 🤖 Claude Code

In the same session:

```
/mine-unit-test --project ~/feedback/<slug>
```

It reads Marta's Did/Should from `_feedback/feedback.json`, pins the sub-skill,
carves the mid-flow scenario the sub-skill actually saw, builds mock fixtures
from the saved `results/`, and writes a draft test under `eval/`.

Sam checks one thing above all: the test must state the **general** rule — *when
two same-named candidates fit the evidence, don't assert one as a conclusion* —
not "the Schuster case." A test that only recognises this one household is a fake
win: it turns green without the skill getting better.

It prints the new test's id (like `ut_person_evidence_022`). That's the `TEST=`
value for Step 7.

### Step 6 — Run it and mark what's wrong ⌨️ Terminal → 🌐 browser

Back in the **worktree root**:

```
make eval-skill SKILL=<skill>            # Windows: eval\RunTests.bat
make eval-ui                             # Windows: eval\Start.bat
```

The batch files prompt for the skill name instead of taking `SKILL=`, and rebuild
the MCP server first. Run them from `eval\` in the worktree.

In the grading UI, Sam finds the new test, sees which dimension it failed, and
pastes **Marta's own Did/Should** into that dimension's comment. This isn't
optional — the improver in the next step proposes nothing for a lone test with no
human comment. The note already exists; it just has to be on the record.

### Step 7 — Improve, then gate 🤖 Claude Code → ⌨️ Terminal

In a Claude Code session at the **worktree root** (not the case folder — the
improver reads `eval/runlogs/`):

> *"improve `<skill>` from its eval results"* — the **skill-improver** agent
> proposes at most 3 small edits and cites the evidence for each. It only
> proposes; Sam applies them by hand.

Then, from a terminal in the same worktree:

```
make gate-skill SKILL=<skill> TEST=ut_person_evidence_022  # Windows: eval\GateSkill.bat
```

The gate re-runs the new test plus the skill's hold-out tests against the edited
skill and compares to the pre-edit baseline. **LOOKS GOOD** → carry on.
**NEEDS YOUR EYES** → the fix didn't land or something regressed; adjust and
re-run. **INCONCLUSIVE** → the bug didn't reproduce on the old skill, so the test
is too weak — back to Step 5.

> **Why gate instead of re-running `make eval-skill` and diffing the scores?** The
> gate runs **one side** — the "before" numbers come from the Step-6 run log you
> already paid for, with your `.ann` corrections overlaid, so you're comparing to
> human ground truth rather than judge-to-judge. It covers only the mined test plus
> hold-outs, so it takes seconds and you can iterate. And it distinguishes
> `INCONCLUSIVE` (the bug never reproduced on the *old* skill, so nothing was
> proven) from a fix that didn't work — a score diff shows you two passing runs and
> lets you conclude, wrongly, that you're done. It writes no run logs, which is why
> the full releasable run still has to happen before the PR.

### Step 8 — Close the loop 🌐 + GitHub

Sam opens a PR with the edit, the mined test, its scenario and fixtures, the run
record, and the grades.

**One *problem* per PR — usually one skill, but not always.** This one is: the fix
lives in `person-evidence`. But a doctrine change like "two same-named candidates
means a hypothesis, not a conclusion" may have to land in `person-evidence`,
`conflict-resolution` **and** `proof-conclusion` at once, because shipping it in one
and not the others leaves the skills contradicting each other mid-research. When a
fix genuinely spans skills, edit them together in the same PR — and run
`make eval-skill` for **each** touched skill, since the runlog CI gate checks every
skill the PR touches. What to avoid is bundling two *unrelated* fixes that happened
to share a branch.

**Then tell Marta what changed.** An alpha tester who never hears back stops
reporting, and the reports are the entire point of the alpha.

---

## Cheat sheet

| Step | What you do | Where |
|---|---|---|
| 0 Branch | `make install-hooks`; `git worktree add .claude/worktrees/<branch> -b <branch> origin/main` | ⌨️ Terminal (worktree) |
| 1 Notice | research; spot it; write Did/Should | 🌐 Workbench |
| 2 Unpack | `make feedback-case ZIP=<zip>` | ⌨️ Terminal (worktree) |
| 3 Continue | `/research` in the case folder; viewer open on it; reproduce it live | 🤖 Claude Code (case dir) + Viewer |
| 4 Classify | skill, tool, or grading fault? | 🤖 Claude Code (case dir) |
| 5 Capture | `/mine-unit-test --project <case-dir>` | 🤖 Claude Code (case dir) |
| 6 Run + mark | `make eval-skill`, `make eval-ui` | ⌨️ Terminal (worktree) → 🌐 browser |
| 7 Improve + gate | `skill-improver`, then `make gate-skill` | 🤖 Claude Code (worktree) → ⌨️ Terminal |
| 8 PR + reply | submit, and tell the tester | GitHub → 🌐 |

## When feedback should become an e2e fixture instead

Most reports become unit tests by the path above — it's cheaper and it runs on
every PR. Reach for an **e2e fixture** ([`e2e-testing-guide.md`](e2e-testing-guide.md))
only when the failure is a *whole-trajectory* one that no single sub-skill test
can express: the agent searched in the wrong order, gave up early, or never
considered an entire record class. Those need a full research run to show up.

Even then, author the fixture from the **FamilySearch PID** with
`/author-e2e-fixture` and use the feedback only to choose the question. A
feedback bundle can't become a fixture directly: it has no attested ground truth
unless the tester filled in that fourth box, and it contains a real person's
research, which a committed fixture must not.
