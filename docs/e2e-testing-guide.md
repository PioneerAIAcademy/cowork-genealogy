# E2E Testing Guide

How to author and run an end-to-end research benchmark test. Written for the
genealogist + developer teams doing the work.

This page covers **the e2e benchmark only** — the expensive, live-FamilySearch
runs that measure how much real research the agent can do on its own. Two
things it deliberately does *not* cover:

| You want to… | Go to |
|---|---|
| Fix a skill problem you noticed while researching | [`skill-lifecycle.md`](skill-lifecycle.md) — mine a unit test, improve, gate, release. That loop is the same wherever the problem came from. |
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
- **MCP server not built** — `make engine-build`.
- **Harness deps** — `cd eval/harness && uv sync`.

---

## Creating a new e2e test

> `author-e2e-fixture`, `interpret-e2e-result`, and `grade-e2e-run` are
> repo-local dev skills under `.claude/skills/` — not part of the shipped Cowork
> plugin. Claude Code picks them up automatically in this checkout, so the
> `/`-commands below just work.

**The normal path is one command.** From a Claude Code session at the repo root
(not Cowork), logged in to FamilySearch:

```
/author-e2e-fixture
```

Give it a FamilySearch PID. It snapshots that person's well-researched tree,
prints an index of every person, relationship, fact and source, and asks you to
pick the subset to strip. It then strips it, records the removals as expected
findings, and writes the files into `eval/tests/e2e/<slug>/`.

The judgment is yours; the mechanics are the skill's. Three calls to get right:

### 1. Pick a well-researched person

- **Deceased.** Required by FamilySearch's terms. This is *enforced* — the
  authoring tool refuses a person marked living, and refuses one whose `living`
  field is simply absent (absent is not deceased).
- **Substantial, diverse sources.** At least 10 attached, spanning multiple
  record types — census + vital + church or probate. Five censuses of the same
  family across years doesn't count.
- **Reasonable size.** Over ~500 KB of snapshot, narrow the scope or pick
  someone else.
- **Stable.** Older records, settled profiles — not ones being actively edited.

### 2. Match the question to what you strip

The research question is what the agent receives. The stripping decides what it
must recover. They have to line up:

| Question | Strip |
|---|---|
| "Who were John's parents?" | Parent persons, parent-child relationships, and the sources attesting parentage |
| "When did Mary die?" | The death event, death facts, death sources |
| "Find John's other children." | *Some* children + their attesting sources |

Keep it small: one focused question, **1–5 expected findings**, not 30.

### 3. Make sure the answer is findable in records

Stripping your local copy isn't enough — **live FamilySearch still has the
answer.** The harness closes that hole by blocking the five tree-reading tools
(`person_read`, `person_search`, `person_ancestors`, `person_record_matches`,
`person_person_matches`) for the whole run, so the agent can't read the answer
back off the tree. It has to do genuine record research.

Which means: pick a question whose answer is **recoverable from records**,
anchored by parents, spouse, children and residences so the agent has a real
starting point. If the only route to the answer runs through the live tree, the
fixture can't measure anything and won't land.

### Author both positive and negative fixtures

- **Positive** (the default) tests **recall** — strip a fact, check it comes
  back.
- **Negative** tests **restraint** — a finding marked `polarity: "avoid"` names
  a plausible-but-wrong candidate the agent should *not* conclude. It scores as
  matched when the agent correctly declined.

Negative fixtures are the only way this benchmark sees **over-claiming** —
concluding from insufficient evidence, which is the failure that matters most
in genealogy, because a wrong parent silently corrupts an entire upstream tree.
Aim for the suite as a whole to cover both, across a spread of question types,
eras and geographies. Details: spec §3.4.1.

### Before you commit

1. **Run the stripping linter** — the crux check:

   ```bash
   make e2e-validate TEST=<slug>       # Windows: eval\ValidateFixture.bat
   ```

   It warns when a finding's answer still looks present in the starting tree
   (which would let the agent get it for free and "pass" every run). `WARN` is
   sometimes a legitimate name collision — review each rather than assuming.
   It hard-fails only on broken files.

2. **Prove it's solvable.** A fixture isn't landable until a real run has
   recovered its findings. Stripping proves the answer isn't *in* the starting
   tree; only a run proves it's *recoverable from live FS*. Run it, confirm
   `pass`, and commit that run log under `eval/runlogs/e2e/<slug>/`. CI blocks a
   fixture without one.

Field tables, the hand-authoring path, cascade rules, and `provided-documents/`
(for answers needing an external PDF): spec §§2–3, §6.2.

---

## Running tests

```bash
make e2e-run TEST=<slug>            # Windows: eval\RunE2E.bat
make e2e-run TAG=parents            # by tag: any tag dimension value
```

**There's no full-suite flag, deliberately** — every run is explicitly scoped
to one test or one tag. A 10-fixture sweep is 4–10 hours and $30–100; if you
genuinely need one, drive it with a shell loop and budget for it.

For the full flag list, ask the tool rather than a doc — the flags change and a
copied list goes stale:

```bash
cd eval/harness && uv run python -m e2e.run_e2e --help
```

### Debugging `/research` by hand

A headless run can't show you *why* the agent stopped or skipped a step. Two
ways to watch one live:

**Cowork + the Research Viewer** (recommended — structured output):
`make e2e-project TEST=<slug>` (Windows: `eval\SeedProject.bat`) seeds an
editable project you open in Cowork with the viewer alongside. See
`eval/README.md` → "Debug a fixture interactively".

**The scratch workspace** (lighter, Claude Code only):

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

Three things that will otherwise cost you an hour:

- **Build the MCP server first** (`make engine-build`). Without it `/research`
  says things like "validate_research_schema isn't available" and degrades to
  guessing — that's a missing server, not a `/research` bug.
- **Skills are copied, not symlinked.** Claude Code's loader resolves copies
  reliably; symlinks are flaky (issue #17741).
- **The interactive session does NOT block the tree-reading tools** the way a
  benchmark run does. Calling them by hand reads the live tree — fine for
  debugging, but don't let a hand-run "pass" that way convince you the fixture
  is solvable. A real run can't do that.

---

## Reading the result

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

Full field reference: spec §8.

---

## When a test fails

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

The full attribution procedure — what to diff, how to read `tool_calls`, and
why the e2e run log has no `skills_invoked` field — is spec §15.

When a fixture's behavior shifts meaningfully, add a dated line to its
`README.md` saying what changed. Next person to run it reads that first.

---

## Grading a run

Every committed run gets graded in the same PR — CI blocks a run log with no
grade beside it.

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

---

## Windows equivalents

Every `make` target above has a batch file in `eval\`. Double-click it or run
it from that folder; each prompts for what it needs instead of taking
`TEST=`-style arguments, and builds the MCP server first where that matters.

| Instead of | Double-click |
|---|---|
| `make e2e-preflight` | `eval\CheckSetup.bat` |
| `make e2e-login` | `eval\Login.bat` |
| `make e2e-run TEST=<slug>` | `eval\RunE2E.bat` |
| `make e2e-validate TEST=<slug>` | `eval\ValidateFixture.bat` |
| `make e2e-project TEST=<slug>` | `eval\SeedProject.bat` |
| `make e2e-scratch TEST=<slug>` | `eval\ScratchResearch.bat` |
| `make electron` | `eval\Viewer.bat` |
| `make e2e-calibrate` *(maintainer)* | `eval\RunCalibration.bat` |

The `/`-commands (`/author-e2e-fixture`, `/interpret-e2e-result`,
`/grade-e2e-run`) are typed into Claude Code and are the same everywhere.

---

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
- [`alpha-feedback-guide.md`](alpha-feedback-guide.md) /
  [`alpha-feedback-example.md`](alpha-feedback-example.md) — triaging a
  feedback zip into a fix
- [`specs/research-schema-spec.md`](specs/research-schema-spec.md),
  [`specs/simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md) —
  schemas behind the starting state
