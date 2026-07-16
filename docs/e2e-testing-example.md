# Skill improvement, start to finish — a worked example

**Who this is for:** a genealogist + developer pair going through the
skill-improvement loop for the first time. It walks **one real-feeling example**
end to end and, at every step, tells you **which of three places you're working
in**. For the terse reference version of these steps, see
[`e2e-testing-guide.md` → "From a noticed issue to a fix"](e2e-testing-guide.md#from-a-noticed-issue-to-a-fix-the-skill-improvement-loop);
for the whole authoring→release lifecycle, see
[`skill-lifecycle.md`](skill-lifecycle.md).

---

## The three places you'll work

You hop between three surfaces. Keeping them straight is the whole trick:

| Icon | Place | What it is | You use it to… |
|---|---|---|---|
| 🖥️ | **Cowork** | The genealogy app where research actually happens (the plugin + skills run here). | *Notice* the problem, and later *confirm* it's fixed. |
| 🤖 | **Claude Code** | A `claude` session opened at the repo root (the Code tab of the desktop app, or `claude` in a terminal). You type requests and Claude runs the developer skills/agents. | *Classify*, *capture the test*, *improve the skill*. |
| ⌨️ | **Terminal** | A plain shell where you type `make …` commands. | *Seed* a project, *run tests*, *gate*, *open the PR*. One `make` command (`make eval-ui`) also opens a **browser** tab — the grading UI. |

Rule of thumb: **Claude Code = you ask Claude to do something. Terminal = you run a
command yourself. Cowork = you do genealogy.**

---

## The story: a citation nobody could find again

Ana (genealogist) is researching the Schuster family. She asks Claude to cite a
1900 U.S. census record she just used. The `citation` skill writes a tidy-looking
citation — but it **leaves out the page and line number**. Without that, no one
could ever open that exact record again. Ana and Ben (developer) turn this into a
permanent fix.

---

### Step 1 — Notice it 🖥️ Cowork

Ana is working in a practice project. Ben seeded it for her earlier from a terminal:

```
make e2e-project TEST=schuster-census
```

That opens an editable project she opens in **Cowork** next to the Research Viewer.
Mid-research, she spots the bad citation and writes down, in plain words, what's
wrong — this note becomes important later:

> **Did:** the citation gave the census year and county but no page or line.
> **Should:** it must include the page/line so the record can be found again.
> **Gap:** the citation skill never says a citation has to be *relocatable*.

That three-part note ("Did / Should / Gap") is the single most valuable thing she
produces all day. Keep it.

### Step 2 — Is it even the skill's fault? 🤖 Claude Code

Not every problem is the skill's. Ben opens a **Claude Code** session at the repo
root and they check the project's `results/` files — the actual data the tools
returned:

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
`eval/tests/unit/citation/` and `eval/fixtures/`. Ben skims the draft; the scenario
carve is the part worth double-checking.

### Step 4 — Run it, and mark what's wrong ⌨️ Terminal → 🌐 browser

Ben runs the skill's tests (which now include the new one) from a **terminal**:

```
make eval-skill SKILL=citation
```

Then he opens the grading UI — a **browser** tab — from the terminal:

```
make eval-ui
```

He finds the new test, sees which quality dimension it failed, and pastes **Ana's
Did/Should/Gap note** into that dimension's comment. This matters: the improver in
the next step will do nothing with a brand-new test *unless* it carries a human
comment like this. Ana already wrote it in Step 1 — now it's on the record.

> **First time on this skill?** `citation` needs 2–3 "hold-out" tests (safety-net
> tests the improver isn't allowed to look at). Ben marks a couple in the browser
> UI *before* this run, so the run above becomes the clean "before" baseline.

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
make gate-skill SKILL=citation TEST=<the new test's id>
```

The gate re-runs the new test plus the hold-out tests on the edited skill and
compares to the "before" baseline from Step 4. It prints one of:

- **LOOKS GOOD** — the failing dimension now passes and nothing regressed.
- **NEEDS YOUR EYES** — the fix didn't land, or a hold-out test dropped. Read the
  table and decide.
- **INCONCLUSIVE** — the test didn't actually fail on the old skill (a weak test).

It's **advice, not a verdict** — Ben still decides. Then he does one full run to
produce the record the PR needs, and marks any disagreements in the browser UI:

```
make eval-skill SKILL=citation
```

### Step 7 — Confirm it in Cowork 🖥️ Cowork

Ana redoes the same citation in **Cowork** and sees the page/line is now there.
This is the real-world sanity check; the unit test from Step 3 is the durable
guard that stops the bug from ever coming back.

### Step 8 — Open the PR ⌨️ Terminal / GitHub

Ben opens a pull request with the skill edit + the new test + the run record + the
grades. A senior reviewer reads the corrected grades and, if it's a real
improvement, releases it. Done.

---

## Cheat sheet: where each step happens

| Step | What you do | Where |
|---|---|---|
| 1 Notice | research; spot the problem; write Did/Should/Gap | 🖥️ Cowork |
| 2 Classify | skill's fault, or a tool/grading fault? | 🤖 Claude Code |
| 3 Capture | make a unit test that shows the bug | 🤖 Claude Code |
| 4 Run + mark | run the test; paste the note on the failing dimension | ⌨️ Terminal → 🌐 browser |
| 5 Audit + improve | rubric-critic (once), then skill-improver; you apply the edits | 🤖 Claude Code |
| 6 Gate | check the fix helps and breaks nothing | ⌨️ Terminal |
| 7 Verify | redo the research; see it fixed | 🖥️ Cowork |
| 8 PR | submit for review | ⌨️ Terminal / GitHub |

## Go deeper

- The reference version of these steps (exact commands, preconditions, what's still
  being built): [`e2e-testing-guide.md` → "From a noticed issue to a fix"](e2e-testing-guide.md#from-a-noticed-issue-to-a-fix-the-skill-improvement-loop).
- The design behind the gate + edit budget:
  [`docs/plan/gated-skill-improvement-slice.md`](plan/gated-skill-improvement-slice.md).
- The whole authoring → test → improve → release lifecycle:
  [`skill-lifecycle.md`](skill-lifecycle.md).
