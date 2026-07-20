# From alpha feedback to a fix — a worked example

**Who this is for:** the genealogist + developer pair triaging alpha feedback for
the first time. It follows **one report** end to end and, at every step, says
**which of three places you're working in**. For the terse reference on the
skill-improvement half, see
[`skill-lifecycle.md`](skill-lifecycle.md).
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
| 🤖 | **Claude Code** | A `claude` session — sometimes in your repo checkout, sometimes in the unpacked case folder. See below. | *Reproducing*, *classifying*, *capturing the test*, *improving the skill*. |
| ⌨️ | **Terminal** | A plain shell for `make …` (Windows: the matching `.bat`). | *Unpacking* the case, *running tests*, *gating*. One `make` target opens a **browser** tab — the grading UI. |

Alpha testers only ever touch the first one. Everything else is us.

Two of the steps below (3 and 8) also want the **Research Viewer** (Electron) open, which is
how you read the research log, assertions and conflicts the agent is writing rather
than inferring them from the chat.

### Where to open what

Two directories are in play, and mixing them up is the commonest early mistake:

| | Directory | Why |
|---|---|---|
| **Terminal** (`make …`) | the **repo root**, on your branch (Step 0) | `make eval-skill` / `make gate-skill` test the working tree, and that's where your skill edit is |
| **Claude Code**, steps 3–5 and 8 | the **case folder** (`~/feedback/<slug>/`) | it *is* the research project; the setup script symlinks the skills in and writes `.feedback-repo-root` pointing back at your checkout, so `mine-unit-test` lands its output in the repo automatically |
| **Claude Code**, step 7 | the **repo root** | `/improve-skill` reads run logs under `eval/runlogs/`, which exist only in the repo |

The case folder is `git init`ed and has the skills symlinked in, so it looks
repo-shaped — but it has no `eval/`. Running `/improve-skill` there is the
commonest slip; the command checks for you and stops.

---

> **Before you start (one-time setup).** Two things gate the back half of this
> loop; skip them and the steps below silently do nothing.
> - **Grading (Steps 6–8)** calls the LLM judge, which needs an Anthropic API key
>   in `eval/.env` (`ANTHROPIC_API_KEY=…`; `Setup.bat` sets this on Windows).
>   Without it every dimension comes back *ungraded*, and an ungraded run log
>   fails the `check-runlogs` CI gate on your PR.
> - **Reproducing (Step 3)** replays Marta's research against live FamilySearch,
>   so you need tokens: `make e2e-login` (Windows: `eval\Login.bat`), once a day.
>
> Steps 5–7 run on saved mock data, so you don't need to be online for them.

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

Marta clicks **Send Feedback** in the same session and writes:

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

*(Step 1 is numbered first because it happens first — days earlier, and by someone
else. Sam's work starts here, at Step 0.)*

Sam is going to end up editing a skill and writing test files into `eval/`, so the
first move is a branch — never work straight on `main`:

```
git checkout -b schuster-parent
```

**Windows (GitHub Desktop):** Current Branch dropdown → **New branch…** → name it
`schuster-parent`, base it on `main` → **Create branch**.

Do this **before** Step 2, not after: the setup script stamps `.feedback-repo-root`
with your checkout *as it is when you run it*, and the mined test lands on whatever
branch is checked out then. Unpack the case while still on `main` and your test
ends up on `main`.

### Step 2 — Unpack the case ⌨️ Terminal

The bundle lands in the shared Drive folder. Sam downloads it and, **from the
repo root**, runs:

```
make feedback-case ZIP=~/Downloads/feedback-2026-07-21T09-14-22Z.zip
```

On Windows, `scripts\setup-feedback-case.bat` takes the same zip path as its first
argument. Both wrap the same script; add `FORCE=1` (or `--force`) to overwrite a
case directory you've already unpacked.

That unpacks into `~/feedback/<slug>/` — `research.json`, `tree.gedcomx.json`,
`results/` (the actual tool responses), `_feedback/feedback.json` with Marta's
three answers, and the session transcript. It also symlinks the skills in, `git
init`s the folder, and writes `.feedback-repo-root` back to your checkout — so it's
a working project wired to the right branch, not an archive.

The script also prints **Marta's original prompt**. Copy it — you'll paste it in
Step 3, and again on every retry. Re-asking the question in your own words is the
easiest way to fail to reproduce a bug.

> **The `git init` is not bookkeeping — it's the retry mechanism.** That initial
> commit is an `imported` baseline of Marta's project exactly as she submitted it.
> The case folder is a *capture*: unlike an e2e fixture, there is no
> `make e2e-project` to re-seed it from. Running the agent mutates it, so every
> attempt after the first needs a reset back to that commit. You'll do this
> several times, so it's worth knowing now.

### Step 3 — Continue the research 🤖 Claude Code

**This is the step that replaces guessing.** Sam opens **the case folder**
(`~/feedback/<slug>/`, not the repo) in Claude Code and re-runs Marta's research by
pasting **her exact prompt** — the one the setup script printed in Step 2, not a
paraphrase.

Before pasting it, open the **Research Viewer** on the same case folder — from a
terminal in the repo:

```
make electron                            # Windows: eval\Viewer.bat
```

then **Open Project** → `~/feedback/<slug>/`. The case folder is exactly the shape
the viewer expects, so Sam gets Marta's project as she saw it and watches it change
live. For this bug that's the whole game: the defect is *an unproven relationship
written into the tree as settled*, and the viewer shows the assertion and its
evidence side by side. The chat will just say it found John's father.

Because the state *is* Marta's state, the agent picks up mid-flow and Sam can
interrupt to ask *"what makes you confident it's that Robert?"* — the answer is
usually the defect in the agent's own words. (Read `_feedback/feedback.json` rather
than re-interviewing Marta; her Did/Should is already there.)

When it finishes, Sam doesn't eyeball the result — he asks:

```
/compare-state --against=what-went-wrong
```

That reads the case folder's current `research.json`, `tree.gedcomx.json` and
`results/` and compares them against Marta's prose, returning a verdict:

- **`matches`** → the bug reproduces. Go to Step 4.
- **`does-not-match`**, and the result looks *acceptable* → intermittent, or
  already fixed on this branch. Note the date and stop.
- **`does-not-match`**, but it's wrong in a *different* way → live APIs are noisy;
  reset (below) and run once more. Still wrong? That's a
  "user-reported bug that doesn't reproduce locally" — escalate rather than guess
  at a fix.

> **Resetting between attempts.** Every rerun — here and in Step 8 — needs *both*
> halves reset or you're testing contaminated state: `git checkout . && git clean -fd`
> in the case folder for the **data**, and `/clear` for the **conversation**, so
> Claude isn't reading its own earlier bad reasoning. (`SKILL.md` edits flow into the
> next invocation on their own.) Windows: GitHub Desktop → **Changes → ⋯ → Discard
> all changes**; full click-path in
> [`alpha-feedback-guide.md`](alpha-feedback-guide.md#3-fix-the-bug--iterate).

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

> **`mine-unit-test` or `draft-unit-test`?** Same output format; the split is
> *when*. Use `mine-unit-test` for a bug you've reproduced and **not yet fixed** —
> this walkthrough's order, and what lets Step 7's gate prove the fix did something.
> Use `draft-unit-test` for the reverse: fix first, `/compare-state
> --against=desired` says `matches`, then promote it.

### Step 6 — Run it and mark what's wrong ⌨️ Terminal → 🌐 browser

> **First time improving this skill? Set its hold-out tests before the run below.**
> Hold-outs are 2–3 individual unit tests the improver in Step 7 is forbidden to
> look at, so they can catch a "fix" that only games the tests it was shown. Step
> 7's gate runs them as its no-regression half — **if the skill has none, that half
> is silently inert and the gate's LOOKS GOOD means less than it appears.** Set them
> in the grading UI (`make eval-ui`): open each test and flip **"Hold out from the
> skill-improver"** on. Pick diverse, stable ones and leave them.
>
> Do it **before** the `make eval-skill` run below. Toggling hold-out is a
> grading-relevant change, so doing it afterwards invalidates the very baseline the
> gate compares against.

Back in the **repo root**:

```
make eval-skill SKILL=<skill>            # Windows: eval\RunTests.bat
make eval-ui                             # Windows: eval\Start.bat
```

The batch files prompt for the skill name instead of taking `SKILL=`, and rebuild
the MCP server first. Run them from `eval\`.

In the grading UI, Sam finds the new test, sees which dimension it failed, and
pastes **Marta's own Did/Should** into that dimension's comment. This isn't
optional — the improver in the next step proposes nothing for a lone test with no
human comment. The note already exists; it just has to be on the record.

### Step 7 — Improve, then gate 🤖 Claude Code → ⌨️ Terminal

In a Claude Code session at the **repo root** (not the case folder — the
improver reads `eval/runlogs/`, which only exists in the repo):

```
/audit-rubric <skill>       # once per skill: is the grading itself sound?
/improve-skill <skill>      # proposes at most 3 edits, evidence cited
```

The improver only **proposes**; Sam applies the edits by hand.

> **Type the commands; don't ask in prose.** Both agents are read-only by
> construction, and a request phrased in prose can miss — leaving ordinary Claude,
> which *does* have Edit and Write, to do the job without the 3-edit budget or the
> you-apply-them gate. The commands also catch the commonest slip here: running the
> improver from the case folder, which has no `eval/`.

Then, from a terminal in the repo:

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
> Step 9's full run still has to happen before the PR.

### Step 8 — Watch the fix work on Marta's actual case 🤖 Claude Code

The gate proves the fix on a *mocked* test. This step proves it on the real thing —
and it's the alpha loop's answer to "confirm it in the product," which you can't do
here: Marta's project is a capture of a real person's research, so it can't be
re-seeded into the workbench.

Instead, replay it. Back in the **case folder**, reset both halves as in Step 3 —

```
git checkout . && git clean -fd          # data back to the imported baseline
```

— start a **fresh session** (`/clear`), paste Marta's original prompt again, and
when it finishes ask:

```
/compare-state --against=desired
```

`--against=desired` this time, not `--against=what-went-wrong`: Sam is checking the
result against what Marta said *should* have happened. `matches` means the edited
skill now handles her case correctly. Keep the Research Viewer open — the fix here
is *an assertion that should no longer be stated as settled*, and that's something
you read in the assertions pane, not in the chat's summary of itself.

If it doesn't match, go back to Step 7. The edit landed on the mined test without
solving the real case, which usually means the test carved too narrow a scenario.

### Step 9 — Produce the record the PR needs ⌨️ Terminal → 🌐 browser

**Don't skip this — the PR fails CI without it.** The `check-runlogs` gate is
blocking and checks two things the Step-6 run can no longer satisfy, because
`SKILL.md` changed underneath it:

- the latest run log per touched skill must be **active** — its embedded snapshot
  matching the branch's current skill files, which the pre-edit run's no longer does;
- its `.ann.json` must carry a correction for **every** (test, dimension) pair.

`make gate-skill` doesn't help here: it writes no run logs by design, which is
exactly why it's cheap enough to iterate on. So do one full run against the edited
skill:

```
make eval-skill SKILL=<skill>            # Windows: eval\RunTests.bat
make eval-ui                             # Windows: eval\Start.bat
```

Then grade it: **Agree with all**, then correct only the dimensions Sam actually
disagrees with. Every dimension has to be reviewed — leaving any ungraded fails
rule 3.

### Step 10 — Close the loop 🌐 + GitHub

Sam opens a PR with the edit, the mined test, *its scenario folder and mock
fixtures* (commit only the test JSON and it can't run), the run record from Step 9,
and the grades.

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
| 0 Branch | `git checkout -b <branch>` (Windows: GitHub Desktop → New branch…) | ⌨️ Terminal (repo) |
| 1 Notice | research; spot it; write Did/Should | 🌐 Workbench |
| 2 Unpack | `make feedback-case ZIP=<zip>`; copy the prompt it prints | ⌨️ Terminal (repo) |
| 3 Reproduce | paste the user's prompt; viewer open on it; `/compare-state --against=what-went-wrong` | 🤖 Claude Code (case dir) + Viewer |
| 4 Classify | skill, tool, or grading fault? | 🤖 Claude Code (case dir) |
| 5 Capture | `/mine-unit-test --project <case-dir>` | 🤖 Claude Code (case dir) |
| 6 Run + mark | set hold-outs (first time), then `make eval-skill`, `make eval-ui` | ⌨️ Terminal (repo) → 🌐 browser |
| 7 Improve + gate | `/audit-rubric`, `/improve-skill`, then `make gate-skill` | 🤖 Claude Code (repo) → ⌨️ Terminal |
| 8 Verify | reset + `/clear` + re-paste the prompt; `/compare-state --against=desired` | 🤖 Claude Code (case dir) + Viewer |
| 9 Release run | `make eval-skill` again, then grade **every** dimension | ⌨️ Terminal (repo) → 🌐 browser |
| 10 PR + reply | submit, and tell the tester | GitHub → 🌐 |

**Between any two attempts** (Step 3 retries, Step 8): `git checkout . && git clean -fd`
in the case folder, plus `/clear` for a fresh session. Data and conversation both.

### Windows equivalents

Every `make` target above has a batch file. Double-click it, or run it from
`eval\`; each prompts for what it needs instead of taking `SKILL=`-style
arguments, and rebuilds the MCP server first where that matters.

| Instead of | Double-click |
|---|---|
| `make feedback-case ZIP=<zip>` | `scripts\setup-feedback-case.bat <zip>` (pass the zip path) |
| `make eval-skill SKILL=<skill>` | `eval\RunTests.bat` |
| `make eval-ui` | `eval\Start.bat` |
| `make gate-skill SKILL=… TEST=…` | `eval\GateSkill.bat` |
| `make electron` | `eval\Viewer.bat` |
| `make e2e-login` | `eval\Login.bat` |
| `git checkout -b <branch>` | GitHub Desktop → Current Branch → **New branch…** |
| `git checkout . && git clean -fd` | GitHub Desktop → Changes → ⋯ → **Discard all changes** |

The `/`-commands (`/compare-state`, `/mine-unit-test`, `/audit-rubric`,
`/improve-skill`) are typed into Claude Code and are the same on every platform.

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

## Go deeper

- The same loop starting from a *seeded* project instead of a feedback zip —
  including the Cowork verification this walkthrough replaces with Step 8:
  [`e2e-testing-example.md`](e2e-testing-example.md).
- The terse reference for steps 5–9 (exact commands, preconditions):
  [`skill-lifecycle.md`](skill-lifecycle.md).
- The full zip-triage click-path, including the Windows/GitHub Desktop route
  through the resets: [`alpha-feedback-guide.md`](alpha-feedback-guide.md).
- Why the case folder is shaped the way it is (the `imported` baseline, the
  marker file, the lints): [`docs/specs/feedback-case-spec.md`](specs/feedback-case-spec.md).
- The whole authoring → test → improve → release lifecycle:
  [`skill-lifecycle.md`](skill-lifecycle.md).
