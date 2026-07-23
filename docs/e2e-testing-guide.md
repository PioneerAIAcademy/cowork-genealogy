# E2E Testing Guide — authoring and running a benchmark fixture

How to author and run an end-to-end research benchmark test, walked through
**one real fixture end to end**. Written for the genealogist + developer teams
doing the work.

This page covers **the e2e benchmark only** — the expensive, live-FamilySearch
runs that measure how much real research the agent can do on its own. Two
things it deliberately does *not* cover:

| You want to… | Go to |
|---|---|
| Fix a skill problem — whether you noticed it while researching or a run exposed it | [`skill-lifecycle.md`](skill-lifecycle.md) — mine a unit test, improve, gate, release. That loop is the same wherever the problem came from, and Step 7 below hands off to it. |
| Look up an exact field, contract, or enum | [`specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the authoritative format. This guide stays task-shaped and sends you there for reference detail. |

---

## What e2e tests are

An e2e test snapshots a real, well-researched FamilySearch person's tree,
strips a focused subset (the "answer"), and asks the agent — via
`/research --autonomous` — to recover what was removed. The judge grades the
final state `pass` / `partial` / `fail`.

They're a **stakeholder-facing benchmark, not a regression suite**. Per-PR
regression coverage is the unit tests in `eval/tests/unit/`.

**Runs are expensive: 20–60 minutes and $3–10 each. Run one at a time.**

> **Before you quote a number to anyone outside the team.** The verdict
> measures *fact recovery, not sound reasoning* — an agent can recover a right
> answer from one weak hit and still `pass`. The advisory proof-quality score
> partly closes that gap, and negative fixtures sample the agent's restraint
> from over-claiming, but neither certifies it. This is a strong **capability
> signal**, not a certification that the agent does sound, verifiable GPS
> research. Don't describe it as the latter. Full framing: spec §1.

## The three places you'll work

| Icon | Place | What it is | You use it to… |
|---|---|---|---|
| ⌨️ | **Terminal** | A plain shell where you type `make …` (Windows: double-click the matching `.bat` in `eval\`). | Set up, validate, seed, run, view. |
| 🤖 | **Claude Code** | A `claude` session at your **repo root** — not Cowork. The `/`-commands below are repo-local dev skills under `.claude/skills/`, picked up automatically in this checkout. | Author the fixture, interpret the result, grade the run. |
| 🖥️ | **Cowork** | The shipping product, with the plugin + MCP extension installed. | Watch `/research` work on the fixture live, before you spend money on a headless run. |

A fourth surface matters throughout: the **Research Viewer** (Electron,
`make electron`), which renders the research log, assertions, conflicts and
sources of whichever project folder you point it at. It's how you *see* what the
agent wrote instead of trusting the chat's summary of itself.

> `author-e2e-fixture`, `interpret-e2e-result`, and `grade-e2e-run` are
> repo-local dev skills — **not** part of the shipped Cowork plugin. The
> `/`-commands are typed into Claude Code and are identical on every platform.

---

## Setup

**Run the preflight first** — it green-lights FamilySearch auth, the built MCP
server, the Anthropic API key, and the harness deps in one shot, so a setup gap
fails here instead of deep inside an expensive run:

```bash
make e2e-preflight                # Windows: eval\CheckSetup.bat
```

If it flags something:

- **FamilySearch login** — `make e2e-login` (Windows: `eval\Login.bat`). The
  token is host-global, shared by every e2e path, and lasts ~24h, so this is
  **once a day**, not once a run. Preflight warns when it's near expiry. If it
  does expire mid-run, FS calls fail loudly in the transcript — re-login and
  re-run; you won't get a silently bad result.
- **MCP server not built** — `make mcpb` (Windows: `eval\BuildMcpb.bat`). It
  compiles the server *and* packs the `.mcpb`, which is what you install in
  Cowork for the live-debugging loop in Step 4.
- **Harness deps** — `cd eval/harness && uv sync`.

---

## The running example

Everything below follows one fixture that's already in the repo:
**`spriggs-parents-1898`** — Reuben Spencer Spriggs, FamilySearch PID
`L64C-QQX`, born 1898 in Maddock, Benson County, North Dakota; died 1998. The
research question is *"Who were the parents of Reuben Spencer Spriggs?"*, and
the answer — his father John William Spriggs, his mother Charlotte Marie
Westby, and the two census sources naming them — is what got stripped.

Read `eval/tests/e2e/spriggs-parents-1898/` alongside this page; substitute your
own slug as you go.

---

## Step 0 — Branch ⌨️ Terminal

One task, one branch, always cut from an up-to-date `main` — you open a PR from
it at the end. Name it with a few hyphenated words describing the task — no
slashes, no timestamps.

**Developers — terminal:**

```bash
git checkout main && git pull
git checkout -b spriggs-parents-fixture
```

**Genealogists — GitHub Desktop:** Current Branch dropdown → select **main** and
**Fetch/Pull** → **New branch…** → name it `spriggs-parents-fixture` → base it
on `main` → **Create branch**.

Everything the rest of this produces — the fixture files, the run log, the
grade — lands on this one branch.

## Step 1 — Pick a person and author the fixture 🤖 Claude Code

**The normal path is one command.** From a Claude Code session at the repo root,
logged in to FamilySearch:

```
/author-e2e-fixture
```

Give it a FamilySearch PID. It snapshots that person's well-researched tree,
prints an index of every person, relationship, fact and source, and asks you to
pick the subset to strip. It then strips it, records the removals as expected
findings, and writes the files into `eval/tests/e2e/<slug>/`.

The judgment is yours; the mechanics are the skill's. What makes a person worth
choosing:

- **Deceased.** Required by FamilySearch's terms. This is *enforced* — the
  authoring tool refuses a person marked living, and refuses one whose `living`
  field is simply absent (absent is not deceased).
- **Substantial, diverse sources.** At least 10 attached, spanning multiple
  record types — census + vital + church or probate. Five censuses of the same
  family across years doesn't count. (Reuben had 12; stripping took it to 10.)
- **Reasonable size.** Over ~500 KB of snapshot, narrow the scope or pick
  someone else.
- **Stable.** Older records, settled profiles — not ones being actively edited.

> There's a second, secondary path for when you have no FamilySearch access:
> building PID-less from a bundled research document, with a placeholder
> `source_pid` you resolve before landing. `/author-e2e-fixture` covers it;
> everything below applies unchanged.

## Step 2 — Match the question to what you strip 🤖 Claude Code

The research question is what the agent receives. The stripping decides what it
must recover. They have to line up:

| Question | Strip |
|---|---|
| "Who were John's parents?" | Parent persons, parent-child relationships, and the sources attesting parentage |
| "When did Mary die?" | The death event, death facts, death sources |
| "Find John's other children." | *Some* children + their attesting sources |

Keep it small: one focused question, **1–5 expected findings**, not 30. The
Spriggs fixture strips five things — two parents, two parent-child
relationships, the parents' own marriage, and the two census sources that name
them — while deliberately *keeping* Reuben's birth, death, residences, obituary,
burial, wife and children, so the agent has a strong anchor to search from.

**Leave the anchors in.** A fixture that strips both the answer and everything
you'd search from measures nothing but frustration.

### Author both positive and negative fixtures

- **Positive** (the default) tests **recall** — strip a fact, check it comes
  back.
- **Negative** tests **restraint** — a finding marked `polarity: "avoid"` names
  a plausible-but-wrong candidate the agent should *not* conclude. It scores as
  matched when the agent correctly declined. (`hole-parents-negative` is the
  worked instance in the repo.)

Negative fixtures are the only way this benchmark sees **over-claiming** —
concluding from insufficient evidence, which is the failure that matters most
in genealogy, because a wrong parent silently corrupts an entire upstream tree.
Aim for the suite as a whole to cover both, across a spread of question types,
eras and geographies. Details: spec §3.4.1.

## Step 3 — Prove the answer is findable ⌨️ Terminal

Stripping your local copy isn't enough — **live FamilySearch still has the
answer.** The harness closes that hole by blocking five tree-reading tools for
the whole run, so the agent can't read the answer back off the tree:

```
person_read   person_search   person_ancestors
person_record_matches   person_person_matches
```

The principle is: block anything keyed off the **subject person** that surfaces
the answer; allow tools keyed off a record the agent had to find first
(`record_person_matches`, `record_record_matches`, `source_attachments`) and
tools that read the *local* stripped tree (`person_warnings`). A fixture can
also name extra tools in its own `blocked_tools` — used when one specific tool
would hand over that fixture's ground truth, e.g. `wiki_search` on a fixture
built from a wiki case study. Spec §6.1.

Which means: pick a question whose answer is **recoverable by research**. Any of
these routes counts — it does not have to be an indexed FamilySearch record:

| Route | How the agent gets there |
|---|---|
| **Indexed records** | `record_search` → `record_read`. The default, and the Spriggs route: the 1910 and 1920 U.S. censuses both list Reuben in his parents' household. |
| **Full text** | `fulltext_search` over unindexed books, deeds, probate, newspapers |
| **Images** | `image_search` / `image_read` / `image_transcribe` on an unindexed film |
| **Off-FamilySearch sources** | Ancestry, FindAGrave, MyHeritage, FindMyPast, a county archive — `external_links_search` finds *where* the record lives |
| **Indirect evidence** | No single source states the answer; the agent assembles it from several (a marriage-record age + a census + a burial) |

One catch on the off-FamilySearch route: **the agent has no web browser during
a run.** The harness allows exactly `Read`, `Write`, `Edit`, `Glob`, `Grep`,
`Skill` and `Task` plus the genealogy MCP tools — `WebFetch` and `WebSearch`
are not on that list, so a run that reaches for one gets back *"Permission to
use WebFetch has been denied"*. That has happened in four committed runs, all
of them trying to read a Norwegian or Québécois archive site directly.
`external_links_search` can tell the agent a record exists on FindAGrave and
where; it cannot read the page. So if the proof genuinely lives off
FamilySearch, capture the document yourself and bundle it in the fixture's
`provided-documents/`. The harness drops it into the workspace exactly where an
uploaded capture lands and names it in the prompt, so the agent reads it with
`Read` and the run stays reproducible. Spec §6.2.

If the only route to the answer runs through the live tree, the fixture can't
measure anything and won't land.

**Then run the stripping linter** — the crux check:

```bash
make e2e-validate TEST=<slug>       # Windows: eval\ValidateFixture.bat
```

It warns when a finding's answer still looks present in the starting tree
(which would let the agent get it for free and "pass" every run). A `WARN` is
sometimes a legitimate name collision — review each rather than assuming. It
**hard-fails (exit 2) only on structural problems**: a missing or unparseable
file, a schema violation, a dangling relationship endpoint or source `ref`.
Suspects are warn-only, by design — they're for the author to judge.

Omit `TEST=` to lint every fixture.

Field tables, the hand-authoring path, cascade rules, and `provided-documents/`
detail: spec §§2–3, §6.2.

## Step 4 — Debug `/research` live, before you pay for a run 🖥️ Cowork + Viewer

A headless run can't show you *why* the agent stopped or skipped a step — and
it charges you 20–60 minutes to not tell you. Watch a run live, fix what you
see, and save the headless run for the verdict.

**Cowork + the Research Viewer** (recommended — structured output):

1. **Build and install both artifacts**, so Cowork has the genealogy tools.
   This is the step that costs an hour when it's skipped:

   ```bash
   make mcpb                       # Windows: eval\BuildMcpb.bat
   make plugin                     # Windows: eval\BuildPlugin.bat
   ```

   Install the `.mcpb` in Claude Desktop → Settings → Extensions → Advanced
   Settings → Install extension (straight over the old copy — no uninstall
   needed). Then **remove any existing Genealogy Research plugin** in Cowork →
   Customize and upload the new `.zip` via Add → Upload Plugin, from the
   **Cowork** tab rather than the Code tab — they keep separate plugin lists.
   **Fully quit and reopen** Claude Desktop. Redo both after any MCP-server or
   skill change; without them `/research` says things like
   "validate_research_schema isn't available" and degrades to guessing, which
   is a missing install, not a `/research` bug.

2. Seed an editable project from the fixture's starting state:

   ```bash
   make e2e-project TEST=<slug>    # Windows: eval\SeedProject.bat
   ```

3. Open `eval/e2e-project/<slug>/` in Cowork and run `/research`. Open the
   **same folder** in the Research Viewer (`make electron`, Windows:
   `eval\Viewer.bat`) to watch the research log, assertions and conflicts
   appear live — and ask Claude *"why didn't you search X?"* as it works.

Full walkthrough: `eval/README.md` → "Debug a fixture interactively".

**The scratch workspace** (lighter — Claude Code only, no Cowork install):

```bash
make e2e-scratch TEST=<slug>        # Windows: eval\ScratchResearch.bat
```

It seeds the fixture's starting state and the plugin skills into a throwaway
directory **outside the repo**, reusing the harness's own `build_workspace` so
it matches a real run, then drops you into `claude` there. In the session:

```
# Claude Code prompts ONCE to approve the project MCP server (.mcp.json).
# Approve it, or /research has no FamilySearch tools and can't research.
# Start WITHOUT --autonomous so you can watch it chain and nudge it:
/research <the researcher question>
```

> **Neither live path blocks the tree-reading tools** the way a benchmark run
> does. Calling them by hand reads the live tree — fine for debugging, but
> don't let a hand-run "pass" that way convince you the fixture is solvable. A
> real run can't do that.

**Land any skill fixes this exposes before you run.** That's
[`skill-lifecycle.md`](skill-lifecycle.md), not this page.

## Step 5 — Run it ⌨️ Terminal

**This is the expensive confirmation at the *end* of the loop, not a debugging
tool.**

```bash
make e2e-run TEST=<slug>            # Windows: eval\RunE2E.bat
```

**One fixture per run.** `make e2e-run` takes `TEST=<slug>` and nothing else,
and the underlying `run_e2e.py` requires `--test` — there is deliberately no
full-suite flag and no tag sweep. A 10-fixture sweep is 4–10 hours and $30–100,
which is a budget decision, not something a one-word flag should make easy to
trigger. If you genuinely need a batch, drive it with a shell loop and budget
for it.

For the full flag list, ask the tool rather than a doc — the flags change and a
copied list goes stale:

```bash
cd eval/harness && uv run python -m e2e.run_e2e --help
```

## Step 6 — Read the result 🤖 Claude Code

**The easy path — run the interpreter skill** on the run, in a Claude Code
session in this checkout:

```
/interpret-e2e-result
```

It reads the run-log files and explains in plain language: the verdict (and
flags a `pass` with low proof quality — "found it but didn't prove it"), the
proof-quality score and what drove it, any blocked tree-reads (did it try to
shortcut?), whether a finding came from a bundled PDF rather than live
research, the stop reason translated into something actionable, and — for a
`partial`/`fail` — the most likely cause.

If you'd rather read the files yourself, each run writes four:

| File | What's in it |
|---|---|
| `run-<ts>.json` | The structured result: verdict, stop reason, judge output, usage, tool calls, blocked tree-reads |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree — what the judge graded |
| `run-<ts>.final-research.json` | The agent's final `research.json` |

To page through that final state visually instead of in JSON:

```bash
make e2e-view TEST=<slug>           # Windows: eval\ViewE2E.bat
```

It copies the newest run's final tree + `research.json` into `eval/e2e-view/`
for the Research Viewer (`make electron`, Windows: `eval\Viewer.bat`).

**Verdict:** `pass` (all required findings matched) / `partial` (some) / `fail`
(none) / `skipped` (the judge never ran).

**Stop reason** — what each one means, as opposed to what triggers it
(spec §6):

| | |
|---|---|
| `completed` | Happy path — proof-conclusion fired and set the project completed |
| `natural_end` | The agent thought it was done; GPS may or may not agree |
| `inactivity` / `timeout` | It stalled — the transcript shows where |
| `tool_cap` / `max_turns` | It may be looping — look for repeated tool calls near the end |
| `cost_cap` | Hit the per-run cost limit |
| `error` | SDK or harness exception; check `result.error` |

One note on reading `blocked_tree_reads`: each entry carries a `blocked_by`
field, because a block isn't always the universal tree-read rule — it may be the
fixture's own `blocked_tools`. Read the field rather than assuming.

Full field reference: spec §8.

## Step 7 — When it fails ⌨️ / 🤖

Read the transcript first — most failures are obvious from it. Then place the
cause before changing anything, because the fix differs completely by cause:

| Cause | Tell |
|---|---|
| **Agent reasoning regression** | Different decisions on the same evidence |
| **`/research` regression** | A GPS step skipped, or the wrong sub-skill ran |
| **Sub-skill regression** | Right sub-skill, worse output |
| **FS data drift** | FS returned different records; the agent behaved correctly against changed inputs |
| **Single-run jitter** | Small deltas, one finding flipping — re-run before concluding |

One trap worth naming: if the agent found the right answer but recorded it
*only* in `research.json` and not in the tree, that is an **agent failure, not
a judge miss**. Landing the answer in the tree is an explicit success criterion
of the GPS flow.

**When it's a skill problem, capture it before you fix it.** In Claude Code:

```
/mine-unit-test --e2e-run eval/runlogs/e2e/<slug>
```

That turns the miss into a unit test — cheap, runs on every PR — and drops you
into [`skill-lifecycle.md`](skill-lifecycle.md) at step 2. Classify the finding
first, though: the lane rule there exists because most e2e findings are tooling
or eval bugs, not skill-prose gaps.

The full attribution procedure — what to diff, how to read `tool_calls`, and
why the e2e run log has no `skills_invoked` field — is spec §15.

When a fixture's behavior shifts meaningfully, add a dated line to its
`README.md` saying what changed. Next person to run it reads that first.

## Step 8 — Grade the run 🤖 Claude Code

Every committed run gets graded in the same PR — **this one is CI-enforced.**
The `check-e2e-fixtures` gate blocks any run log *added* in your PR that
produced a final tree but ships no `run-<ts>.ann.json` beside it. (A treeless
run — crashed or skipped before a final tree — is exempt; there's nothing to
grade.)

```
/grade-e2e-run
```

It shows you each expected finding plus the agent's evidence, and writes
`run-<ts>.ann.json` with your labels. It reads the fixture and the run's final
tree — deliberately **not** the judge's own grades — so you label blind. That
independence is what makes the agreement number mean anything. Commit the
`.ann.json`.

**You never run `calibrate_judge`** — not even `--dry-run`. That's the
maintainer's periodic step once a batch of grades exists, and it's the only
thing that calls the judge API at scale. Collecting grades *before* the judge
is calibrated is the intended bootstrap, not a problem.

Annotation format, the ≥80% agreement gate, and how to read a calibration
report: spec §7.4.

## Step 9 — Land it ⌨️ Terminal / GitHub

Commit the fixture directory, the run log, and its `.ann.json` together, push
the Step-0 branch, and open the PR.

**Prove it's solvable.** Stripping proves the answer isn't *in* the starting
tree; only a run proves it's *recoverable from live FS*. So run the fixture,
confirm `pass`, and commit that run log under `eval/runlogs/e2e/<slug>/`.

> This is a **strong convention, not a CI check** — `check_e2e_fixtures.py`
> deliberately does not gate it, because draft and PID-less fixtures routinely
> land without a passing run first. What CI *does* block is the grading rule
> above. Landing an unproven fixture is a judgment call you should be able to
> defend in review, not something the machine will stop.

---

## Cheat sheet

| Step | What you do | Where |
|---|---|---|
| 0 Branch | `git checkout -b <short-task-name>` | ⌨️ Terminal |
| 1 Author | `/author-e2e-fixture` — pick a deceased, well-sourced person | 🤖 Claude Code |
| 2 Scope | one question, 1–5 findings; keep the search anchors | 🤖 Claude Code |
| 3 Validate | check the answer is findable; `make e2e-validate TEST=<slug>` | ⌨️ Terminal |
| 4 Debug live | `make e2e-project`, then `/research` in Cowork with the Viewer open | 🖥️ Cowork + Viewer |
| 5 Run | `make e2e-run TEST=<slug>` — one fixture, 20–60 min, $3–10 | ⌨️ Terminal |
| 6 Read | `/interpret-e2e-result`; `make e2e-view` for the visual pass | 🤖 Claude Code |
| 7 Attribute | place the cause; `/mine-unit-test --e2e-run …` for a skill miss | 🤖 Claude Code |
| 8 Grade | `/grade-e2e-run` → commit the `.ann.json` (CI-enforced) | 🤖 Claude Code |
| 9 Land | commit fixture + run log + grade; open the PR | ⌨️ Terminal / GitHub |

## Windows equivalents

Every `make` target above has a batch file in `eval\`. Double-click it or run
it from that folder; each prompts for what it needs instead of taking
`TEST=`-style arguments, and builds the MCP server first where that matters.

| Instead of | Double-click |
|---|---|
| `make e2e-preflight` | `eval\CheckSetup.bat` |
| `make e2e-login` | `eval\Login.bat` |
| `make mcpb` | `eval\BuildMcpb.bat` |
| `make plugin` | `eval\BuildPlugin.bat` |
| `make e2e-validate TEST=<slug>` | `eval\ValidateFixture.bat` |
| `make e2e-project TEST=<slug>` | `eval\SeedProject.bat` |
| `make e2e-scratch TEST=<slug>` | `eval\ScratchResearch.bat` |
| `make e2e-run TEST=<slug>` | `eval\RunE2E.bat` |
| `make e2e-view TEST=<slug>` | `eval\ViewE2E.bat` |
| `make electron` | `eval\Viewer.bat` |
| `make e2e-calibrate` *(maintainer)* | `eval\RunCalibration.bat` |
| `git checkout -b <short-task-name>` | GitHub Desktop → Current Branch → **New branch…** |

The `/`-commands (`/author-e2e-fixture`, `/interpret-e2e-result`,
`/grade-e2e-run`, `/mine-unit-test`) are typed into Claude Code and are the same
everywhere.

## Related docs

- [`specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the authoritative
  format: fixture fields, execution pipeline, judge contract, calibration,
  failure attribution
- [`skill-lifecycle.md`](skill-lifecycle.md) — turning a noticed problem into
  a committed skill fix
- [`eval/README.md`](../eval/README.md) — harness conventions, interactive
  debugging in Cowork
- [`alpha-user-guide.md`](alpha-user-guide.md) — what alpha testers do (they
  research in the hosted app; they don't author fixtures)
- [`alpha-feedback-guide.md`](alpha-feedback-guide.md) — triaging a feedback
  zip into a fix, and when a report should become an e2e fixture instead
- [`specs/research-schema-spec.md`](specs/research-schema-spec.md),
  [`specs/simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md) —
  schemas behind the starting state
