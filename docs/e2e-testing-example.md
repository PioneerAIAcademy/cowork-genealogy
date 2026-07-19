# Skill improvement, start to finish — a worked example

**Who this is for:** a genealogist + developer pair going through the
skill-improvement loop for the first time. It walks **one real-feeling example**
end to end and, at every step, tells you **which of three places you're working
in**. For the terse reference version of these steps, see
[`e2e-testing-guide.md` → "From a noticed issue to a fix"](e2e-testing-guide.md#from-a-noticed-issue-to-a-fix-the-skill-improvement-loop);
for the whole authoring→release lifecycle, see
[`skill-lifecycle.md`](skill-lifecycle.md).

> **The roles, names, and slug here are just for the story.** "Ana" (genealogist)
> and "Ben" (developer) split the work to make it concrete, but the split is only
> illustrative — **anyone can do any step they're comfortable with**, and one person
> can run the whole loop. The Schuster family and the `schuster-census` slug in the
> commands below are invented for the example too; for a real run, use an existing
> fixture slug from `eval/tests/e2e/`.

---

## The three places you'll work

You hop between three surfaces (plus the viewer, below). Keeping them straight is
the whole trick:

| Icon | Place | What it is | You use it to… |
|---|---|---|---|
| 🖥️ | **Cowork** | The genealogy app where research actually happens (the plugin + skills run here). | *Notice* the problem, and later *confirm* it's fixed. |
| 🤖 | **Claude Code** | A `claude` session opened at your **worktree** root (the Code tab of the desktop app, or `claude` in a terminal) — see "Where to work" below. You type requests and Claude runs the developer skills/agents. | *Classify*, *capture the test*, *improve the skill*. |
| ⌨️ | **Terminal** | A plain shell where you type `make …` commands (Windows: double-click the matching `.bat` in `eval\`). | *Seed* a project, *run tests*, *gate*, *open the PR*. One `make` command (`make eval-ui`) also opens a **browser** tab — the grading UI. |

Rule of thumb: **Claude Code = you ask Claude to do something. Terminal = you run a
command yourself. Cowork = you do genealogy.**

A fourth surface shows up alongside Cowork: the **Research Viewer** (Electron),
which renders the research log, assertions, conflicts and sources of whichever
project folder you point it at. It's how you *see* what the agent wrote, so open
it whenever you open a project in Cowork.

### Where to work: make a worktree first

**Everything below happens on a branch, in a worktree — never in the main
checkout.** Do this once, before Step 1, from your normal repo:

```
make install-hooks                       # once per clone, not once per branch
git worktree add .claude/worktrees/citation-locator -b citation-locator origin/main
```

The `install-hooks` step matters: its `post-checkout` hook auto-links the shared
gitignored files (`node_modules`, `eval/.env`, `apps/server/.env`) into every new
worktree, so the new one can build and run tests immediately. Without it you'll
get a worktree that can't run anything.

Then, for the rest of this walkthrough:

- **Terminal `make …` commands** run from the **worktree root**
  (`.claude/worktrees/citation-locator/`), not the main checkout — that's where
  your skill edit lives, and `make eval-skill` / `make gate-skill` test the
  working tree.
- **Claude Code** opens at the **same worktree root**. `mine-unit-test` writes
  into `eval/` relative to wherever you started it, so starting it in the main
  checkout would drop your new test on the wrong branch.
- The one exception is the **project folder** you research in (Step 1) — that's a
  seeded scratch project under `eval/e2e-project/<slug>/`, not repo source.

---

## The story: a citation nobody could find again

Ana (genealogist) is researching the Schuster family. She asks Claude to cite a
1900 U.S. census record she just used. The `citation` skill writes a tidy-looking
citation — but it **leaves out the page and line number**. Without that, no one
could ever open that exact record again. Ana and Ben (developer) turn this into a
permanent fix.

---

> **Before you start (one-time setup).** Two things gate this loop; skip them and the
> steps below silently do nothing.
> - **Cowork steps (1 and 7)** need the genealogy tools installed *into Cowork*: log in
>   to FamilySearch (`make e2e-login`, once a day), then `make mcpb` and `make plugin`.
>   Plain `make engine-build` wires only the Claude Code side — in Cowork the project
>   would open with no tools and there'd be nothing to notice or confirm.
> - **Grading steps (4 and 6)** call the LLM judge, which needs an Anthropic API key in
>   `eval/.env` (`ANTHROPIC_API_KEY=…`; `Setup.bat` sets this on Windows). Without it
>   every dimension comes back *ungraded* and the loop produces nothing gradeable.
>
> The middle steps run on saved mock data, so you don't need to be online for them.

---

### Step 1 — Notice it 🖥️ Cowork

Ana is working in a practice project. Ben seeded it for her earlier from a terminal:

```
make e2e-project TEST=schuster-census        # Windows: eval\SeedProject.bat
```

That writes an editable project into `eval/e2e-project/schuster-census/`. Ana opens
that folder in **two** places:

- **Cowork**, to do the research.
- the **Research Viewer**, to watch what gets written — launch it from a *second*
  terminal and leave it running:

```
make electron                                # Windows: eval\Viewer.bat
```

Then click **Open Project** in the viewer and pick the same
`eval/e2e-project/schuster-census/` folder. It live-updates as the agent works.
Skip this and you're judging the research from the chat transcript alone, which is
exactly how a bad citation slips past.

Mid-research, she spots the bad citation and writes down, in plain words, what's
wrong — this note becomes important later:

> **Did:** the citation gave the census year and county but no page or line.
> **Should:** it must include the page/line so the record can be found again.
> **Gap:** the citation skill never says a citation has to be *relocatable*.

That three-part note ("Did / Should / Gap") is the single most valuable thing she
produces all day. Keep it.

### Step 2 — Is it even the skill's fault? 🤖 Claude Code

Not every problem is the skill's. Ben opens a **Claude Code** session at the
**worktree root** he made above and they check the project's `results/` files —
the actual data the tools returned:

- If the census tool **did** return the page/line and the skill dropped it → it's a
  **skill** problem. Continue. ✅ (This is their case.)
- If the tool **never returned** the page/line → it's a **tool** problem — a
  different fix (an engineering ticket), *not* a skill edit. Stop here.
- If the skill did the right thing and the *test* would unfairly mark it wrong →
  that's a grading problem for later, not a skill edit.

Skipping this check is the classic trap: rewriting the skill's instructions for a
bug that actually lives in a tool.

### Step 3 — Capture it as a test 🤖 Claude Code

In the same **Claude Code** session, Ben runs the **`mine-unit-test`** skill,
points it at Ana's project folder, and pastes her Did/Should/Gap note. It writes a
small **unit test** that reproduces the bug — "given a census record that has a
page/line, the citation must include it" — plus a scenario and mock fixtures (built
from the project's saved search results), all marked *draft* under
`eval/tests/unit/citation/` and `eval/fixtures/`. Ben skims the draft and checks one
thing above all: the test must state the **general** rule — "any census record with a
page/line must include it" — not "this one Schuster record." A test that only
recognizes this exact record is a fake win: it turns green without the skill actually
getting better. (The scenario carve is the part most worth a second look.)

When it finishes, `mine-unit-test` prints the new test's **id** — a string like
`ut_citation_019`, also the `id` field in the file it wrote under
`eval/tests/unit/citation/`. That's the `TEST=` value you'll need in Step 6.

### Step 4 — Run it, and mark what's wrong ⌨️ Terminal → 🌐 browser

> **First time improving this skill? Set its hold-out tests first — before the run
> below.** Hold-out tests are 2–3 *individual* unit tests (not whole runs) that the
> improver in Step 5 is forbidden to look at, so they can catch a "fix" that only
> games the tests it was shown. Mark them in the grading UI: run `make eval-ui`, open
> each test, and flip the **"Hold out from the skill-improver"** switch on — pick
> diverse, stable ones and leave them set. Do it *before* the `make eval-skill` run
> below, because toggling hold-out changes the test and would otherwise spoil this run
> as the clean "before" baseline. (`citation` already has its hold-out tests set —
> `ut_citation_001` and `ut_citation_014` — so you can skip this for citation; a
> brand-new skill usually has none.)

Ben runs the skill's tests (which now include the new one) from a **terminal**:

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
```

Then he opens the grading UI — a **browser** tab — from the terminal:

```
make eval-ui                                 # Windows: eval\Start.bat
```

The batch files do the same thing, prompting for the skill name instead of taking
`SKILL=`; both rebuild the MCP server first. Run them from `eval\` in your
worktree, not the main checkout.

He finds the new test, sees which quality dimension it failed, and pastes **Ana's
Did/Should/Gap note** into that dimension's comment. This matters: the improver in
the next step will do nothing with a brand-new test *unless* it carries a human
comment like this. Ana already wrote it in Step 1 — now it's on the record.

### Step 5 — Ask Claude to improve the skill 🤖 Claude Code

Back in **Claude Code**, first a quick health check of the grading itself:

> *"audit the rubric for citation"* — runs the **rubric-critic** agent (read-only).
> Do this once so you're not chasing a broken grade.

Then the improvement itself:

> *"improve citation from its eval results"* — runs the **skill-improver** agent.

It reads the test + Ana's comment and proposes **at most 3** small, plain-English
edits to the skill's instructions — e.g. *"every citation must include a locator
(page/line/entry) that lets a reader reopen the exact record; if the record has
none, write a 'missing locator' marker instead."* The agent only **proposes** —
Ben pastes the edits into `citation/SKILL.md` himself.

### Step 6 — Check the fix helps and breaks nothing ⌨️ Terminal

From a **terminal**, Ben gates the edit:

```
make gate-skill SKILL=citation TEST=<the new test's id>   # Windows: eval\GateSkill.bat
```

The gate re-runs the new test plus the hold-out tests on the edited skill and
compares to the "before" baseline from Step 4. It prints one of:

- **LOOKS GOOD** — the failing dimension now passes and nothing regressed → go do the
  release run below.
- **NEEDS YOUR EYES** — the fix didn't land, or a hold-out test dropped. Read the
  table, adjust the edit in `SKILL.md`, and re-run `make gate-skill` — don't open the
  PR yet.
- **INCONCLUSIVE** — the bug didn't reproduce on the *old* skill. Usually a too-weak
  test, but grading isn't deterministic, so it can also be plain run-to-run luck →
  re-run once; if it stays inconclusive, go back to Step 3 for a sharper test.

It's **advice, not a verdict** — Ben still decides.

> **Why not just re-run `make eval-skill` and compare the numbers?** You could, and
> you'd get a worse answer for more money. Four differences:
>
> - **It runs one side, not two.** The "before" numbers come from the Step-4 run log
>   you already have. A re-run-and-compare pays for a full suite twice and needs you
>   to grade both.
> - **The "before" side is human ground truth.** The gate overlays your `.ann`
>   corrections onto the Step-4 scores. Comparing two raw runs compares judge to
>   judge, and the judge is the thing you just spent Step 5 not fully trusting.
> - **It's the mined test + hold-outs, not the whole suite** — seconds, so you can
>   iterate on the edit instead of committing to it.
> - **It tells you when the *test* is the problem.** `INCONCLUSIVE` means the bug
>   never reproduced on the un-edited skill, so nothing was proven either way. A
>   score diff can't distinguish that from "the fix didn't work" — it just shows two
>   passing runs and you conclude, wrongly, that you're done.
>
> It also writes **no run logs**, so it can't muddy the releasable record. That's
> why the full run below still has to happen.

Then he does one full run to produce the record the PR needs:

```
make eval-skill SKILL=citation               # Windows: eval\RunTests.bat
```

Then he grades it in the browser UI (`make eval-ui`): click **Agree with all**, then
correct only the few dimensions he disagrees with. **Every** dimension has to be
reviewed — leaving any un-graded makes the PR's automated check fail.

### Step 7 — Confirm it in Cowork 🖥️ Cowork

First rebuild and re-upload the plugin so Cowork runs the *edited* skill, not the old
one: `make plugin` (Windows: `eval\BuildPlugin.bat`), then remove the old plugin in
Cowork → Customize and upload the new `.zip`. (Cowork runs the uploaded plugin
`.zip`, not your working tree — skip this and the fix will look like it did nothing.)

Then Ana redoes the same citation in **Cowork**, with the **Research Viewer** open on
the same project folder again:

```
make electron                                # Windows: eval\Viewer.bat
```

The viewer is the point here, not a nicety: the fix is a *citation string in the
research log*, and reading it in the viewer is how you confirm the page/line is
actually there rather than trusting the chat's summary of what it wrote.

This is the real-world sanity check; the unit test from Step 3 is the durable guard
that stops the bug from ever coming back.

### Step 8 — Open the PR ⌨️ Terminal / GitHub

Ben opens a pull request with the skill edit + the new test *and the scenario folder
and mock fixtures `mine-unit-test` created for it* (under `eval/tests/unit/citation/`
and `eval/fixtures/`; commit only the test JSON and it can't run) + the run record +
the grades. A senior reviewer reads the corrected grades and, if it's a real
improvement, releases it. Done.

**One *problem* per PR — which is usually, but not always, one skill.** A locator
rule that belongs in `citation` alone is a one-skill PR. But some fixes genuinely
span skills: a doctrine change about how evidence is classified may have to land in
`person-evidence`, `conflict-resolution` and `proof-conclusion` together, because
shipping it in one and not the others leaves the skills contradicting each other
mid-research. When that happens, edit them all in the same PR — and run
`make eval-skill` for **each** touched skill, since the runlog CI gate checks every
skill the PR touches, not just the first. What you should not do is bundle two
*unrelated* fixes because they happened to be on your branch at the same time.

---

## Cheat sheet: where each step happens

| Step | What you do | Where |
|---|---|---|
| 0 Branch | `make install-hooks`, then `git worktree add .claude/worktrees/<branch> -b <branch> origin/main`; open Claude Code + all terminals **there** | ⌨️ Terminal |
| 1 Notice | research; spot the problem; write Did/Should/Gap | 🖥️ Cowork + Viewer |
| 2 Classify | skill's fault, or a tool/grading fault? | 🤖 Claude Code |
| 3 Capture | make a unit test that shows the bug | 🤖 Claude Code |
| 4 Run + mark | run the test; paste the note on the failing dimension | ⌨️ Terminal → 🌐 browser |
| 5 Audit + improve | rubric-critic (once), then skill-improver; you apply the edits | 🤖 Claude Code |
| 6 Gate | check the fix helps and breaks nothing | ⌨️ Terminal |
| 7 Verify | rebuild + re-upload the plugin; redo the research; see it fixed | 🖥️ Cowork + Viewer |
| 8 PR | submit for review | ⌨️ Terminal / GitHub |

## Go deeper

- The reference version of these steps (exact commands, preconditions, what's still
  being built): [`e2e-testing-guide.md` → "From a noticed issue to a fix"](e2e-testing-guide.md#from-a-noticed-issue-to-a-fix-the-skill-improvement-loop).
- The design behind the gate + edit budget:
  [`docs/plan/gated-skill-improvement-slice.md`](plan/gated-skill-improvement-slice.md).
- The whole authoring → test → improve → release lifecycle:
  [`skill-lifecycle.md`](skill-lifecycle.md).
