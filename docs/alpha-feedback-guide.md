# Alpha feedback guide — from a submission to a fix

You have a user feedback zip and you need to fix the bug and lock the fix in
with a regression test. This page walks **one report end to end** and, at every
step, says which of three places you're working in.

**Two companion docs, and when to reach for each:**

| Doc | What it gives you |
|---|---|
| [`skill-lifecycle.md`](skill-lifecycle.md) | The improvement loop itself: run the test, annotate, audit the rubric, improve the `SKILL.md`, gate the edit, produce the release run. Shared with every other on-ramp — this page hands off to it at Step 6 and comes back for Steps 7–10. |
| [`specs/feedback-case-spec.md`](specs/feedback-case-spec.md) | The **why**: rationale, contracts, lints. Read only when changing the workflow itself. |

## Who does what

| Role | What they do |
|---|---|
| **You** (junior genealogist or developer) | The whole loop: download the zip, reproduce the bug, capture the test, improve the skill, build + install the plugin, verify in Cowork, and open the PR. |
| **Senior genealogist** | Reviews the PR — skill changes, rubric quality, the new unit test — and approves the merge. |

If you get stuck mid-flow, ask for help. The spec is precise about which
steps benefit from a second pair of eyes.

## The three places

| Icon | Place | What it is | Used for |
|---|---|---|---|
| 🌐 | **The workbench** | <https://genealogy-workbench.fly.dev> in a browser. Where alpha testers research. | *Noticing* the problem and *reporting* it. |
| 🤖 | **Claude Code** | A `claude` session — sometimes in your repo checkout, sometimes in the unpacked case folder. See below. | *Reproducing*, *classifying*, *capturing the test*, *improving the skill*. |
| ⌨️ | **Terminal** | A plain shell for `make …` (Windows: the matching `.bat`). | *Unpacking* the case, *running tests*, *gating*. One `make` target opens a 🌐 browser tab — the grading UI. |

Alpha testers only ever touch the first one. Everything else is us.

Steps 3 and 7 also want the **Research Viewer** (Electron, `make electron`)
open, which is how you read the research log, assertions and conflicts the agent
is writing rather than inferring them from the chat.

### Where to open what

Two directories are in play, and mixing them up is the commonest early mistake:

| | Directory | Why |
|---|---|---|
| **Terminal** (`make …`) | the **repo root**, on your branch (Step 1) | `make eval-skill` / `make gate-skill` test the working tree, and that's where your skill edit is |
| **Claude Code**, Steps 3–5 and 7 | the **case folder** (`~/feedback/<slug>/`) | it *is* the research project; the setup script symlinks the skills in and writes `.feedback-repo-root` pointing back at your checkout, so `mine-unit-test` lands its output in the repo automatically |
| **Claude Code**, Step 6 | the **repo root** | `/improve-skill` reads run logs under `eval/runlogs/`, which exist only in the repo |

The case folder has the skills symlinked in, so it looks repo-shaped — but it
has no `eval/`. Running `/improve-skill` there is the commonest slip; the
command checks for you and stops.

## One-time setup (per machine)

Already done? Skip ahead.

- Cowork installed with the genealogy plugin + MCP server. See the
  "Installation" section of `README.md`.
- Claude Code installed and signed in.
- FamilySearch tokens in `~/.familysearch-mcp/tokens.json`. If you've used the
  plugin from Cowork this exists already; otherwise run the `login` tool once.
- This repo cloned. The walk-through below assumes `~/cowork-genealogy` on
  macOS/Linux and `%USERPROFILE%\cowork-genealogy\` on Windows; adjust paths if
  yours is elsewhere. (GitHub Desktop's default clone location is
  `%USERPROFILE%\Documents\GitHub\cowork-genealogy\` — use whichever path you
  actually cloned to.)
- Windows users: GitHub Desktop installed and signed in. You don't need to know
  git from the command line — the workflow uses the GUI to make a branch and
  commit, and resetting a case is its own double-click script.

> **Two things gate the back half of this loop; skip them and the steps below
> silently do nothing.**
> - **Grading (Steps 6 and 9)** calls the LLM judge, which needs an Anthropic
>   API key in `eval/.env` (`ANTHROPIC_API_KEY=…`; `Setup.bat` sets this on
>   Windows). Without it every dimension comes back *ungraded*, and an ungraded
>   run log fails the `check-runlogs` CI gate on your PR.
> - **Reproducing (Step 3)** replays the tester's research against live
>   FamilySearch, so you need tokens: `make e2e-login` (Windows:
>   `eval\Login.bat`), once a day.
>
> The middle steps run on saved mock data, so you don't need to be online for
> them.

---

## The story: a parent nobody proved

> **The names and the case are invented for the story.** "Marta" is the alpha
> tester; you're the one running the fix. Anyone can do any step, and one person
> runs the whole loop.

Marta is working a brick wall — John Schuster, born about 1845 in Augusta
County. The agent finds an 1850 census household headed by a Robert Schuster
containing a 5-year-old John, and concludes Robert is John's father. It writes
the relationship into the tree and moves on.

Marta knows the county. There were **two** Robert Schusters there in 1850, and
the census alone can't distinguish them. The agent didn't mention the second
one, didn't look for anything to separate them, and stated the conclusion
flatly. It might even be right — but it hasn't been *shown*, and a wrong parent
silently corrupts everything upstream of it.

## Step 0 — Notice it 🌐 The workbench

Marta clicks **Send Feedback** in the same session and writes:

> **What I asked:** Find John Schuster's parents (b. ~1845, Augusta Co., VA).
>
> **What the agent did:** Concluded from one 1850 census household that Robert
> Schuster was John's father, and wrote it into the tree as settled.
>
> **What it should have done:** Flagged that two Robert Schusters lived in
> Augusta County in 1850, said the census alone can't tell them apart, and
> either looked for something to separate them — probate, land, church records
> — or recorded it as a hypothesis rather than a conclusion.
>
> **The correct answer and its evidence:** *(left blank — see below)*

Marta leaves the fourth box empty, and that's the right call: **the answer isn't
known to be wrong — it's unproven.** That box is for when the agent reached a
*wrong conclusion* and you can supply the right one. Here the defect is the
reasoning, so the third box carries the whole report.

That three-part note is the most valuable thing produced all day. Everything
below is mechanics.

## Step 1 — Branch before you touch anything ⌨️ Terminal

*(Step 0 happened days earlier, and by someone else. Your work starts here.)*

One task, one branch, always cut from an up-to-date `main` — you open a PR from
it at the end. Name it with a few hyphenated words describing the fix — no
slashes, no timestamps.

**Terminal:**

```bash
cd ~/cowork-genealogy
git checkout main && git pull
git checkout -b schuster-parent-fix
```

**GitHub Desktop:** Current Branch dropdown → select **main** and
**Fetch/Pull** → **New branch…** → name it `schuster-parent-fix` → base it on
`main` → **Create branch**.

Do this **before** Step 2, not after: the setup script stamps
`.feedback-repo-root` with your checkout *as it is when you run it*, and the
mined test lands on whatever branch is checked out then. Unpack the case while
still on `main` and your test ends up on `main`.

## Step 2 — Unpack the case ⌨️ Terminal

The bundle lands in the shared Drive folder. Download it and, **from the repo
root**, run:

**macOS / Linux:**

```bash
make feedback-case ZIP=~/Downloads/feedback-2026-07-21T09-14-22Z.zip

# or call the script directly:
scripts/setup-feedback-case.sh ~/Downloads/feedback-2026-07-21T09-14-22Z.zip
```

**Windows (Command Prompt — not by double-clicking, so you can see the prompt
it prints at the end):**

```bat
%USERPROFILE%\cowork-genealogy\scripts\setup-feedback-case.bat ^
    "%USERPROFILE%\Downloads\feedback-2026-07-21T09-14-22Z.zip"
```

Both wrap the same script. Add `FORCE=1` (or `--force`) to overwrite a case
directory you've already unpacked; pass `DEST=` (or a second positional
argument) to put it somewhere other than the default.

The script:

- unzips into `~/feedback/<slug>/` on macOS/Linux, or
  `%USERPROFILE%\feedback\<slug>\` on Windows (slug = the zip basename) —
  `research.json`, `tree.gedcomx.json`, `results/` (the actual tool responses),
  `_feedback/feedback.json` with Marta's answers, and the session transcript,
- snapshots that pristine state so `make feedback-reset` can restore it later,
- writes a `.feedback-repo-root` marker telling the workflow skills where your
  repo lives,
- wires per-skill links (symlinks on macOS/Linux, directory junctions on
  Windows) so Claude Code finds both the plugin skills you're debugging and the
  workflow skills,
- prints **Marta's original prompt** — copy it. You'll paste it in Step 3, and
  again on every retry. Re-asking the question in your own words is the easiest
  way to fail to reproduce a bug.

> **Why the snapshot matters — it's the retry mechanism.** The case folder is a
> *capture*: unlike an e2e fixture, there is no `make e2e-project` to re-seed it
> from. Running the agent mutates it, so every attempt after the first starts
> from a reset. That's one command (`make feedback-reset`, below) — you'll run
> it several times, so it's worth knowing now.

## Step 3 — Reproduce it 🤖 Claude Code (case folder) + Viewer

**This is the step that replaces guessing.** Open **the case folder**
(`~/feedback/<slug>/`, not the repo) in Claude Code — use the exact `cd` and
`claude` commands the setup script printed, which are already platform-correct:

```bash
cd ~/feedback/feedback-2026-07-21T09-14-22Z    # your case's slug
claude
```

Before pasting the prompt, open the **Research Viewer** on the same case folder
— from a terminal in the repo:

```bash
make electron                            # Windows: eval\Viewer.bat
```

then **Open Project** → `~/feedback/<slug>/`. The case folder is exactly the
shape the viewer expects, so you get Marta's project as she saw it and watch it
change live. For this bug that's the whole game: the defect is *an unproven
relationship written into the tree as settled*, and the viewer shows the
assertion and its evidence side by side. The chat will just say it found John's
father.

Now paste **her exact prompt** — the one the setup script printed, not a
paraphrase. Because the state *is* Marta's state, the agent picks up mid-flow
and you can interrupt to ask *"what makes you confident it's that Robert?"* —
the answer is usually the defect in the agent's own words. (Read
`_feedback/feedback.json` rather than re-interviewing Marta; her Did/Should is
already there.)

When it finishes, don't eyeball the result — ask:

```
/compare-state --against=what-went-wrong
```

That reads the case folder's current `research.json`, `tree.gedcomx.json` and
`results/` and compares them against Marta's prose, returning a verdict:

- **`matches`** → the bug reproduces. Go to Step 4.
- **`does-not-match`**, and the result looks *acceptable* → the bug is
  intermittent or already fixed on this branch. Note the date and stop.
- **`does-not-match`**, but it's wrong in a *different* way → live APIs are
  noisy; reset (below) and run once more. Still wrong? That's a "user-reported
  bug that doesn't reproduce locally" — escalate for help rather than
  guessing at a fix.
- **`partial`** → either the reproduction is genuinely incomplete, or it's
  live-MCP noise. Try once more; if it oscillates, get a second pair of eyes on it.

> **Resetting between attempts.** Every rerun — here and in Step 7 — needs
> *both* halves reset, or you're testing contaminated state:
>
> ```bash
> make feedback-reset CASE=~/feedback/<slug>   # the DATA
> ```
>
> Windows: double-click `scripts\reset-feedback-case.bat`, or run it with the
> case folder as its argument.
>
> Then `/clear` (or quit and relaunch `claude`) for the **conversation**, so
> Claude isn't reading its own earlier bad reasoning. `SKILL.md` edits flow into
> the next invocation on their own — no restart needed for those.
>
> The reset restores every file the agent touched and removes any it added,
> while leaving the linked-in skills alone. It refuses to run anywhere that
> isn't a feedback case folder, so it can't be pointed at your repo by mistake.

## Step 4 — Whose fault is it? 🤖 Claude Code (case folder)

Not every report is a skill problem. Using the `results/` files — the real tool
responses — check:

- Did `record_search` **return** the second Robert Schuster, and the skill
  ignore him? → a **skill** problem. Continue. ✅ *(This is the case.)*
- Did the search **never surface** him? → a **tool** problem. Different fix, an
  engineering ticket, not a prose edit.
- Did the skill behave correctly and a stale rubric would mark it wrong? → a
  **grading** fix.

Skipping this check is the classic trap: rewriting instructions for a bug that
lives in a tool. The full four-lane version is
[`skill-lifecycle.md`](skill-lifecycle.md) §5 — read it before you touch prose.

## Step 5 — Capture it as a test 🤖 Claude Code (case folder)

In the same session:

```
/mine-unit-test --project ~/feedback/<slug>
```

It reads Marta's Did/Should from `_feedback/feedback.json`, pins the sub-skill,
carves the mid-flow scenario the sub-skill actually saw, builds mock fixtures
from the saved `results/`, and writes a draft test under `eval/` in your repo
(it finds the repo via the `.feedback-repo-root` marker).

Check one thing above all: the test must state the **general** rule — *when two
same-named candidates fit the evidence, don't assert one as a conclusion* — not
"the Schuster case." A test that only recognises this one household is a fake
win: it turns green without the skill getting better.

It prints the new test's id (like `ut_person_evidence_022`). That's the `TEST=`
value for the gate in Step 6.

> **Capture the test *before* you fix the bug.** That's what lets Step 6's gate
> prove the fix did something: it compares against a pre-edit baseline, so a
> test mined *after* the fix comes back `INCONCLUSIVE` — the bug no longer
> reproduces on the un-edited skill, and nothing is proven either way.

> **Scrub the scenario for PII before you commit it.** This is the one step
> unique to feedback cases and the reason they can't be treated like any other
> test source: the scenario is carved from a **real person's research**. The
> auto-scrub is best-effort. Open the scenario and generalize anything that
> slipped through — names → `Person A`, exact dates → the decade, specific
> places → the county. A committed test lives in the repo forever.

## Step 6 — Run, annotate, improve, gate → the standard loop

Everything from here to a gated fix is the same regardless of where the bug came
from, so it lives in one place:

**→ [`skill-lifecycle.md`](skill-lifecycle.md), steps 3–6**

It covers: setting hold-out tests (do this *before* the baseline run), running
`make eval-skill SKILL=<skill>`, pasting Marta's Did/Should onto the failing
dimension in the grading UI, `/audit-rubric`, `/improve-skill`, applying the
edits yourself, and `make gate-skill SKILL=<skill> TEST=<the mined test id>`.

Two things there are easy to skip and will fail CI if you do — grading **every**
dimension, and doing a **full run after** your skill edit so the committed run
log matches the edited skill.

Run the terminal commands from the **repo root**, and `/improve-skill` from a
Claude Code session at the **repo root** — not the case folder, which has no
`eval/`.

Come back here when the gate says **LOOKS GOOD**.

## Step 7 — Watch the fix work on Marta's actual case 🤖 Claude Code (case folder) + Viewer

The gate proves the fix on a *mocked* test. This step proves it on the real
thing.

Back in the **case folder**, reset both halves as in Step 3 — the data back to
the state it was imported in, and the conversation with `/clear`:

```bash
make feedback-reset CASE=~/feedback/<slug>   # Windows: scripts\reset-feedback-case.bat
```

Then paste Marta's original prompt again, and when it finishes ask:

```
/compare-state --against=desired
```

`--against=desired` this time, not `--against=what-went-wrong`: you're checking
the result against what Marta said *should* have happened. `matches` means the
edited skill now handles her case correctly. Keep the Research Viewer open — the
fix here is *an assertion that should no longer be stated as settled*, and
that's something you read in the assertions pane, not in the chat's summary of
itself.

If it doesn't match, go back to Step 6. The edit landed on the mined test
without solving the real case, which usually means the test carved too narrow a
scenario.

## Step 8 — Confirm it in Cowork 🖥️ Cowork

**Treat this as blocking.** Steps 3 and 7 both run
in Claude Code against symlinked skills; this is the only step that exercises
the fix the way a user gets it — through the built plugin bundle in the real
product.

First build and install the artifacts so Cowork runs the *edited* skill:

```bash
make plugin                              # Windows: eval\BuildPlugin.bat
make mcpb                                # Windows: eval\BuildMcpb.bat
```

Install the `.mcpb` in Claude Desktop → Settings → Extensions, remove the old
plugin in Cowork → Customize, upload the new `.zip`, and **fully quit and reopen
Desktop**. Cowork runs the uploaded `.zip`, not your working tree — skip this
and the fix will look like it did nothing.

Then unzip the **original feedback zip** into a *fresh* folder, so Cowork sees
the pristine user state rather than your iterated-on one:

```bash
mkdir -p ~/feedback/<slug>-cowork-check
unzip -d ~/feedback/<slug>-cowork-check ~/Downloads/feedback-<timestamp>.zip
```

No symlinks, no `.claude/skills/`, no reset machinery — Cowork loads from its
installed plugin bundle, so the fresh unzip is all it needs. Open that folder in
Cowork as a project, re-issue Marta's prompt verbatim, and confirm
the fix holds. (If Cowork's UI won't open an existing folder directly, follow
its workspace-creation flow and copy `research.json`, `tree.gedcomx.json`,
`results/` and the other top-level files across.)

If the fix **doesn't** hold in Cowork, the bug may be Cowork-runtime-specific —
plugin loader, viewer context injection, OS-specific file handling. Diagnose it
(get help if you need it); **do not ship the PR.**

## Step 9 — Release run, PR, and reply ⌨️ Terminal → 🌐 browser → GitHub

The `check-runlogs` CI gate is blocking and checks two things your Step-6
baseline run can no longer satisfy, because `SKILL.md` changed underneath it:
the latest run log per touched skill must be **active** (its snapshot matching
the branch's current skill files), and its `.ann.json` must carry a correction
for **every** (test, dimension) pair. `make gate-skill` writes no run logs by
design, so do one full run against the edited skill:

```bash
make eval-skill SKILL=<skill>            # Windows: eval\RunTests.bat
make eval-ui                             # Windows: eval\Start.bat
```

Grade it: **Agree with all**, then correct only the dimensions you actually
disagree with. Every dimension has to be reviewed.

Then commit on your branch. **macOS / Linux:**

```bash
cd ~/cowork-genealogy
git add packages/engine/plugin/skills/<name>/ \
        eval/tests/unit/<name>/ \
        eval/fixtures/scenarios/<slug>/ \
        eval/fixtures/mcp/ \
        eval/runlogs/unit/<name>/
git commit -m "fix: <one-line summary of the bug>"
```

**Windows (GitHub Desktop):** switch the repository picker to
**cowork-genealogy** (not the case directory), tick **only** the paths above —
the SKILL.md you edited, the new test JSON, the scenario directory, the MCP
fixtures, and the run log **and** its `.ann.json` — type
`fix: <one-line summary>` in the Summary box, and **Commit to
`schuster-parent-fix`**.
Commit only the test JSON and it can't run.

The commit message *is* the lesson — explain what went wrong and what changed.
There's no separate lesson file by design.

**One *problem* per PR — usually one skill, but not always.** This one is: the
fix lives in `person-evidence`. But a doctrine change like "two same-named
candidates means a hypothesis, not a conclusion" may have to land in
`person-evidence`, `conflict-resolution` **and** `proof-conclusion` at once,
because shipping it in one and not the others leaves the skills contradicting
each other mid-research. When a fix genuinely spans skills, edit them together
in the same PR — and run `make eval-skill` for **each** touched skill, since the
runlog gate checks every skill the PR touches. What to avoid is bundling two
*unrelated* fixes that happened to share a branch.

You push and open the PR; the senior genealogist reviews and
merges.

**Then tell Marta what changed.** An alpha tester who never hears back stops
reporting, and the reports are the entire point of the alpha.

## Step 10 — Clean up

When the PR is merged, delete both case directories:

- `~/feedback/<slug>/` — your iteration workspace
- `~/feedback/<slug>-cowork-check/` — the fresh unzip from Step 8

Use your OS's file manager or any delete method you trust. The zip stays in the
Drive folder as the immutable record, so re-importing later is always possible.

---

## Cheat sheet

| Step | What you do | Where |
|---|---|---|
| 0 Notice | research; spot it; write Did/Should | 🌐 Workbench |
| 1 Branch | `git checkout -b <short-task-name>` | ⌨️ Terminal (repo) |
| 2 Unpack | `make feedback-case ZIP=<zip>`; copy the prompt it prints | ⌨️ Terminal (repo) |
| 3 Reproduce | paste the user's prompt; viewer open; `/compare-state --against=what-went-wrong` | 🤖 Claude Code (case dir) + Viewer |
| 4 Classify | skill, tool, or grading fault? | 🤖 Claude Code (case dir) |
| 5 Capture | `/mine-unit-test --project <case-dir>`; scrub PII | 🤖 Claude Code (case dir) |
| 6 Improve + gate | → [`skill-lifecycle.md`](skill-lifecycle.md) steps 3–6 | ⌨️ Terminal + 🤖 Claude Code (repo) |
| 7 Verify the case | reset + `/clear` + re-paste; `/compare-state --against=desired` | 🤖 Claude Code (case dir) + Viewer |
| 8 Confirm in Cowork | build + install; fresh unzip; re-issue the prompt | 🖥️ Cowork |
| 9 Release run + PR | `make eval-skill`, grade **every** dimension, commit, PR, reply | ⌨️ Terminal → 🌐 browser → GitHub |
| 10 Clean up | delete both case directories | ⌨️ Terminal / file manager |

**Between any two attempts** (Step 3 retries, Step 7):
`make feedback-reset CASE=~/feedback/<slug>` for the data, plus `/clear` for a
fresh session. Both halves, every time.

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
| `make plugin` / `make mcpb` | `eval\BuildPlugin.bat` / `eval\BuildMcpb.bat` |
| `make feedback-reset CASE=<dir>` | `scripts\reset-feedback-case.bat` |
| `git checkout -b <short-task-name>` | GitHub Desktop → Current Branch → **New branch…** |

The `/`-commands (`/compare-state`, `/mine-unit-test`, `/audit-rubric`,
`/improve-skill`) are typed into Claude Code and are the same on every
platform.

---

## Common errors

**`/compare-state` says "Not a feedback-case directory."**
You're not in a directory set up by `setup-feedback-case.sh`. Run the setup
script first, then `cd` into the resulting directory.

**`/compare-state` says feedback.json has empty `<field>`.**
The user's submission was missing a required field. Ask them to resubmit — that
field is required by the submission format
(`apps/electron/docs/feedback-json-spec.md`).

**`/mine-unit-test` can't identify the failing skill.**
Run it as `/mine-unit-test --skill <name>` and pick the skill you edited.

**`run_tests.py` says `fixture_not_found`.**
Your fix made the agent call a tool the failing transcript didn't. The harness
has no fixture for that call. Ask a teammate to add the fixture under
`eval/fixtures/mcp/`.

**`/compare-state --against=desired` keeps saying `partial`.**
Two possibilities: the fix really is incomplete — keep iterating; or live-MCP
noise — the same query returns slightly different results run to run. Try once
more. If it stabilizes you're good; if it oscillates, the rubric may be too
tight and you'll want a second pair of eyes on it.

**Setup script says the destination already exists.**
You ran setup on the same zip before. Either delete the old case directory or
pass `--force` / `FORCE=1` to overwrite (the script's commit history was
throwaway anyway).

**The gate says `INCONCLUSIVE`.**
The bug never reproduced on the *un-edited* skill, so nothing was proven either
way. Usually a too-weak test — but grading isn't deterministic, so re-run once
before going back to Step 5 for a sharper one.

## When feedback should become an e2e fixture instead

Most reports become unit tests by the path above — it's cheaper and it runs on
every PR. Reach for an **e2e fixture**
([`e2e-testing-guide.md`](e2e-testing-guide.md)) only when the failure is a
*whole-trajectory* one that no single sub-skill test can express: the agent
searched in the wrong order, gave up early, or never considered an entire record
class. Those need a full research run to show up.

Even then, author the fixture from the **FamilySearch PID** with
`/author-e2e-fixture` and use the feedback only to choose the question. A
feedback bundle can't become a fixture directly: it has no attested ground truth
unless the tester filled in that fourth box, and it contains a real person's
research, which a committed fixture must not.

## When you actually need the spec

The spec is [`docs/specs/feedback-case-spec.md`](specs/feedback-case-spec.md).
Read it when:

- You're proposing a change to the workflow itself.
- You're building or maintaining `/compare-state`, `/mine-unit-test`, or the
  setup and reset scripts.
- You're adding a new skill and need to write its
  `## Re-invocation behavior` section.
- You hit an edge case this page doesn't cover and want to know what the
  contract says.

If you're just triaging a case, this page is enough. The spec is 1000 lines;
this page is one flow for a reason.

## Related docs

- [`skill-lifecycle.md`](skill-lifecycle.md) — the improvement loop Steps 6
  hands off to, and the reference for every stage of it
- [`alpha-user-guide.md`](alpha-user-guide.md) — what the alpha tester sees
- [`e2e-testing-guide.md`](e2e-testing-guide.md) — authoring and running a
  benchmark fixture
- [`specs/feedback-case-spec.md`](specs/feedback-case-spec.md) — why the case
  folder is shaped the way it is (the `imported` baseline, the marker file, the
  lints)
