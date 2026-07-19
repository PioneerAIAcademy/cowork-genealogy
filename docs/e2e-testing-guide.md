# E2E Testing Guide

Practical instructions for creating and running e2e tests.

For the test format specification, see
[`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md). For the
design rationale and the remaining build work, see the plan at
[`docs/plan/e2e-skills.md`](plan/e2e-skills.md).

---

## What e2e tests are

An e2e test snapshots a real well-researched FamilySearch person's
tree, strips a focused subset of the information (the "answer"), and
asks the agent — via the `/research --autonomous` entry point — to
recover what was removed. The judge grades the agent's final state and
reports `pass` / `partial` / `fail`.

**What the benchmark measures — read this before quoting a number.**
The judge grades two things:

- **Recall (the verdict):** did the agent recover the stripped facts?
  Graded from the agent's `tree.gedcomx.json` against
  `expected-findings.json`.
- **Proof quality (advisory score):** is the agent's written GPS proof
  statement sound? Graded from the research log's `proof_summaries`.
  This rides alongside the verdict and never changes it.

Recall measures *fact recovery, not sound reasoning* — an agent can
recover a right answer from a single weak hit and still `pass`. The
proof-quality score partially closes that gap. What stays only
*sampled*, not guaranteed, is the agent's **restraint from
over-claiming** — tested by negative fixtures (below), not certified.
So: this is a strong capability signal, not a certification that the
agent does fully sound, verifiable GPS research. Don't describe it as
the latter to stakeholders.

**The answer can't be read off the tree.** You strip the answer from the
*local* tree, but live FamilySearch still has it — so the harness blocks
the tree-reading tools (`person_read`, `person_search`,
`person_ancestors`) for the whole run. The agent must recover everything
from **records**, which is what makes a `pass` mean "researched it," not
"looked it up." Any blocked attempts are logged in the run's
`blocked_tree_reads`. See spec §6.1.

E2e tests are a **stakeholder-facing benchmark**, not a regression
suite. Per-PR regression coverage is handled by unit tests in
`eval/tests/unit/`.

E2e runs are **expensive**: one fixture is typically 20–60 minutes
of wall-clock and $3–10 in API costs. Run one at a time.

---

## First-time setup checklist

If you're standing up the e2e suite for the first time, work through
this in order. Each step gates the next.

1. **Verify prerequisites** — run `CheckSetup.bat` (or `uv run python -m
   e2e.preflight` from `eval/harness/`). It green-lights FS auth, the
   built MCP server, the Anthropic API key, and the harness deps in one
   shot, so a setup gap fails here instead of deep inside an expensive
   run. Fix anything it flags (next section has the details) before
   continuing.
2. **Manually validate `/research`.** Before trusting any headless run,
   exercise `/research` interactively — the fastest way is the **scratch
   workspace** (`make e2e-scratch TEST=<slug>`; Windows:
   `ScratchResearch.bat`). It seeds a fixture's starting state + the
   plugin skills into a throwaway dir outside the repo and prints the
   `/research` command to paste in an interactive `claude` session. See
   "Debugging `/research` by hand" below. Confirm:
   - The skill chains through GPS sub-skills (question-selection →
     research-plan → search-records → record-extraction → …) without
     skipping major steps.
   - It reaches `proof-conclusion` or at least makes credible
     progress toward an answer.
   - Refine `packages/engine/plugin/skills/research/SKILL.md` if the routing cues
     don't trip cleanly. Iterate until "reasonably reliable" — not
     perfect, just good enough that future fixture failures will
     reflect agent capability rather than primer bugs.
3. **Eyeball a candidate PID.** Pick a well-researched person
   (acceptance criteria below) and snapshot them (§2 of "Creating a new
   e2e test"). Check JSON size; pick a different PID if unwieldy.
4. **Author the first fixture.** Run `/author-e2e-fixture` and give it
   the PID — it snapshots the tree, you name what to strip, and it
   writes the fixture files. (Or follow §4 in "Creating a new
   e2e test" to author by hand.) Keep it focused (one question, 1–5
   expected findings). Then **run the stripping linter**
   (`uv run python -m e2e.validate_fixture <slug>`; Windows:
   `ValidateFixture.bat`) and resolve any `WARN` before committing — see
   "Creating a new e2e test" §5.
5. **Run the first e2e test:**
   ```bash
   cd eval/harness
   uv run python -m e2e.run_e2e --test <slug>      # Windows: RunE2E.bat
   ```
6. **Grade the run into a calibration annotation.** Run `/grade-e2e-run` to grade
   this run — it reads the fixture and the run's two `final-*` siblings (not the
   run log itself, so you grade *blind* to the judge's own calls), shows you each
   expected finding + the agent's evidence, and writes `run-<ts>.ann.json` beside
   the run log with your `per_finding` labels, and self-checks that file. Then
   commit the `.ann.json` — you do **not** run `calibrate_judge`. **All
   `calibrate_judge` use** (`--dry-run` classification and the full agreement
   sweep, tuning `judge_prompt.md`) is the maintainer's step, done periodically
   once a batch of grades exists. See "Judge calibration" below.
7. **Finalize the spec** at `docs/specs/e2e-test-spec.md` based on
   what the first run actually needed (drop the "Provisional" note).
8. **Add a second fixture** with non-overlapping tags. Verify both
   run without code changes.

After that, fixture authoring becomes routine.

---

## Prerequisites

Before running any e2e test:

1. **FamilySearch login.** Run `make e2e-login` (or `Login.bat`) — it
   opens a browser for FamilySearch OAuth and writes
   `~/.familysearch-mcp/tokens.json`. The token is **host-global and
   shared by every e2e run** (headless harness, scratch session,
   interactive) and lasts ~24h, so this is a **once-per-day** step, not
   per-run. `make e2e-preflight` reports the token's age and **warns**
   when it's near the ~24h limit; if it does expire mid-run, the agent's
   FamilySearch calls fail loudly in the transcript (the run won't
   silently produce a bad result) — re-login and re-run.

2. **Built MCP server.** The harness spawns the TypeScript MCP
   server via stdio:
   ```bash
   cd packages/engine/mcp-server
   npm install
   npm run build
   ```
   This produces `packages/engine/mcp-server/build/index.js`. The harness fails
   loudly if this file is missing.

3. **Python harness installed.** From the repo root:
   ```bash
   cd eval/harness
   uv sync
   ```

4. **Validated `/research` skill.** Before authoring fixtures,
   manually exercise `/research <question>` on a handful of real
   research questions in normal Claude Code use and verify the
   agent chains through GPS reasonably. The fixture authoring step
   assumes `/research` is "reasonably reliable" — if it isn't,
   fixture failures won't tell you anything about agent capability.

---

## Creating a new e2e test

> **Where these skills live.** `author-e2e-fixture`, `interpret-e2e-result`, and
> `grade-e2e-run` are repo-local dev tooling under `.claude/skills/` (alongside
> `compare-state`, `draft-unit-test`, and `mine-unit-test`), **not** part of the shipped Cowork plugin. Claude Code
> picks them up automatically when you work in this checkout, so the `/`-commands
> below just work. See [`docs/plan/e2e-skills.md`](plan/e2e-skills.md) for why
> they're a distinct class from the research skills.

**If you're a genealogist**, run the `/author-e2e-fixture` skill from a Claude Code session opened at the **repo root** — the Code
tab of the Claude desktop app, or `claude` in a terminal (not Cowork).
Be logged in to FamilySearch first (`Login.bat`, or `make e2e-login` for
developers); the skill shells out to a script that reuses that token, so
you no longer approve an MCP server on first open. The primary path
starts from a FamilySearch person ID: give it a PID and it snapshots
that person's well-researched tree to `unstripped-tree.gedcomx.json` and
prints an index of every person, relationship, fact and source. You pick
the focused subset to strip (the "answer"); it strips that subset,
records it as expected findings, and writes the files **directly into
`eval/tests/e2e/<slug>/`** (no move needed). No prior research project is
needed — the tree on FamilySearch is the ground truth. (A secondary,
PID-less path builds a fixture from a research document when there is
no PID; a finished research project converts via its subject's PID,
reusing the project's `proof_summaries` for the question and answer.)

The skill's mechanical half is `eval/harness/e2e/author.py`. It
normalizes the fetched tree to the simplified-GedcomX schema, refuses on
any person who is living or unmarked, cascades relationship removals off
a stripped person, and lints for an answer left behind. Developers can
drive it directly: `make e2e-author ARGS="snapshot --slug foo --pid ABCD-123"`.

The rest of this section documents the schema and the manual workflow
for when you want to author by hand, debug a fixture, or review a PR
that adds one.

### 1. Pick a well-researched PID

Acceptance criteria for a "well-researched" person:

- **Deceased.** Required by FamilySearch's terms for committed test
  data. Confirm in the person record.
- **Substantial source attachment.** At least 10 attached sources
  covering multiple record types (e.g., census + vital + church or
  probate). 5 sources of the same census across multiple years
  doesn't count — diversity matters.
- **Reasonable tree size.** Not so vast that the JSON is unwieldy
  (>200 sources, deep ancestor branches). If the snapshot is over
  ~500 KB, narrow scope or pick someone else.
- **Clear research question.** You can phrase a natural-language
  question whose answer is anchored in attached evidence (e.g.,
  "Who were John Smith's parents?", "When did Mary Jones die?").
- **Stable.** Older records, contributed-and-stable persons, not
  ones with active editing wars.

### 2. Eyeball the JSON

Snapshot the unstripped tree before committing to it:

```bash
cd eval/harness && uv run python -m e2e.author snapshot --slug <slug> --pid <the-pid>
```

It fetches, normalizes to simplified GEDCOMX (persons, relationships,
sources — the `tree.gedcomx.json` shape), writes
`eval/tests/e2e/<slug>/unstripped-tree.gedcomx.json`, and prints an index
of every id. Check source count and relationship depth. If it's unwieldy,
delete the directory and pick a different PID.

The snapshot happens exactly once per fixture — the command refuses to
overwrite an existing one. To see whether FamilySearch has drifted under
a committed fixture, add `--check`: it diffs and writes nothing.

### 3. Pick a research question and stripping pattern

The research question is what the agent receives as user input. The
stripping pattern decides what the agent must recover. Match them:

- **Question: "Who were John's parents?"** → strip parent persons,
  parent-child relationships, and sources that attest the
  parentage.
- **Question: "When did Mary die?"** → strip the death event, death
  facts, and death sources.
- **Question: "Find John's other children."** → strip some (not
  all) children + their attesting sources.

Keep fixtures small for v1 — one focused question per fixture. A
fixture should be answerable with 1–5 expected findings, not 30.

#### The honesty problem — and how the tree-read block solves it

Stripping the answer from your *local* copy isn't enough: **live
FamilySearch still has it.** The fix is the tree-read block (§6.1): the
harness blocks `person_read`, `person_search`, `person_ancestors`,
`person_record_matches`, and `person_person_matches`, so the agent
**cannot read the stripped answer back off the live tree.** It must
recover the fact by genuine record research — searching collections,
reading records and images, and (for off-FamilySearch evidence) the
bundled `provided-documents/`. That's what makes recall an honest
capability number rather than a retrieval shortcut.

Pick a question whose answer is **findable in records** from the
starting state you ship — anchored by parents, spouse, children, and
residences so the agent has a real search starting point. If the only
path to the answer runs through the live tree, the fixture can't measure
research and won't land.

### 4. Author the fixture files

Create the directory:

```
eval/tests/e2e/<slug>/
  fixture.json
  starting-research.json
  starting-tree.gedcomx.json
  expected-findings.json
  README.md
  provided-documents/      (optional — bundled external-evidence PDFs)
```

**`provided-documents/` (optional).** Some answers need a document from a
site the FamilySearch MCP tools can't reach (Ancestry, Find A Grave, a
county PDF). The real `/research` flow has the *user* upload that capture;
a headless e2e run has no user and no `WebFetch`. So bundle the capture
here — the harness copies it into the workspace (where an upload would
land) and tells the agent to read it. Prefer answers that don't need this
(default to FamilySearch-recoverable evidence); bundle only when the
question genuinely requires the external doc. The bundled file must be
the *evidence*, never a written-out statement of the answer. See
spec §6.2.

For full field tables and constraints, see
[`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md) §3. The
minimal shapes:

#### `fixture.json`

```json
{
  "id": "smith-parents-1850",
  "name": "Find John Smith's parents from 1850 census evidence",
  "source_pid": "ABCD-123",
  "captured": "2026-05-26",
  "researcher_question": "Who were John Smith's parents?",
  "tags": {
    "question_type": "parents",
    "era": "1850s",
    "geography": "US-VA"
  },
  "model": {
    "agent": "claude-sonnet-4-6",
    "judge": "claude-opus-4-8"
  },
  "difficulty": "easy",
  "notes": "Well-attested parentage; should be straightforward."
}
```

- `researcher_question` is sent to the agent as
  `/research --autonomous <researcher_question>`.
- `tags` must cover at least `question_type`, `era`, `geography`
  so the roll-up report can group results. Add more dimensions
  freely (`record_type`, `ambiguity_level`, …).

#### `starting-research.json`

A pre-populated `research.json` (full schema in
`docs/specs/research-schema-spec.md`). Minimum content:

```json
{
  "project": {
    "id": "rp_smith_parents",
    "objective": "Who were John Smith's parents?",
    "subject_person_ids": ["ABCD-123"],
    "status": "active",
    "created": "2026-05-26T00:00:00Z",
    "updated": "2026-05-26T00:00:00Z"
  },
  "researcher_profile": {
    "experience_level": "intermediate",
    "subscriptions": [],
    "narration_guidance": "concise"
  },
  "questions": [],
  "plans": [],
  "log": [],
  "sources": [],
  "assertions": [],
  "person_evidence": [],
  "conflicts": [],
  "hypotheses": [],
  "timelines": [],
  "proof_summaries": [],
  "evaluations": []
}
```

- `project.status` must be `"active"` (not `"completed"`). The
  `project_status` enum is `active` / `paused` / `completed` — there is
  no `in_progress`.
- `researcher_profile.narration_guidance` must be `"concise"` so
  narration style doesn't vary across runs.
- All array fields start empty — the agent does the work from a
  clean slate. (`/author-e2e-fixture` writes a schema-valid file for
  you; this shape is for hand-authoring.)

#### `starting-tree.gedcomx.json`

The unstripped tree per `simplified-gedcomx-spec.md`, with the
answer information removed. Structure varies by what you stripped
— there is no minimal template. Derive it from the committed
`unstripped-tree.gedcomx.json` rather than editing it by hand:

```bash
cd eval/harness && uv run python -m e2e.author strip --slug <slug> \
  --persons <ids> --facts <owner>:<fact-id> --sources <ids>
```

`strip` always reads the snapshot and writes the starting tree, never
the reverse, so re-running it with a different selector set is free.
Removing a person cascades to every relationship touching them; sources
never cascade (whether a source attests the stripped fact is your call).

#### `expected-findings.json`

```json
{
  "findings": [
    {
      "id": "f1",
      "type": "relationship",
      "description": "John Smith's father is Robert Smith",
      "details": {
        "subject_person": "John Smith (PID ABCD-123)",
        "relation": "parent",
        "target_person": {
          "name": "Robert Smith",
          "birth": "~1820 Virginia"
        }
      },
      "supporting_sources": [
        "1850 US Census, Augusta County VA, household of Robert Smith"
      ],
      "required": true
    }
  ]
}
```

- `type` is one of `relationship` / `fact` / `person` / `source`.
- `description` is plain-language; the judge reads it.
- `details` is structured data; the exact shape varies by `type`.
- `supporting_sources` is context for the judge (not strict-matched).
  If the agent finds the right answer via different sources, that
  still counts as a match.
- `required: true` findings are recall targets — missing any fails
  the test. `required: false` are bonus.

#### `README.md`

Human notes — no schema, just required content:

- The source PID and an explicit "<Name> is deceased" line (FS ToS
  requirement; the suite refuses living-person fixtures).
- What was removed from the starting tree and why.
- Author's expected difficulty and any notes useful for someone
  reviewing a failed run.

### 5. Sanity-check before committing

- The four JSON files parse without error.
- **Run the stripping linter** — the crux check. Every expected finding
  must be genuinely *absent* from `starting-tree.gedcomx.json`; if a
  finding's answer is still in the tree, the agent gets it for free and
  the fixture silently "passes" every run:

  ```bash
  cd eval/harness
  uv run python -m e2e.validate_fixture <slug>     # or --all
  ```

  Windows: `ValidateFixture.bat` (prompts for the slug).

  It's **warn, don't block**: `WARN` lines flag a finding whose target
  person/fact still looks present (name-token overlap) — review each and
  confirm it's genuinely stripped (a `WARN` is sometimes a legitimate
  match, e.g. a common surname). It hard-fails (exit 2) only on broken
  fixture files. Still re-read the tree for anything the linter can't see
  (a stripped *source* that the findings don't name by person).
- The research question is answerable in natural-language form
  (avoid "find the source at ARK 1:1:XXXX" — too literal).
- **Prove the fixture is solvable, then commit the passing run log.** A
  fixture isn't landable until at least one real run has recovered its
  findings — stripping completeness proves the answer isn't *in* the
  starting tree, but only a real run proves it's *recoverable from live
  FS*. Run the fixture for real (next section), confirm `verdict: pass`,
  and commit that run log under `eval/runlogs/e2e/<slug>/` alongside the
  fixture. The `check-e2e-fixtures` CI check blocks a PR that adds a
  fixture without a committed passing run log (spec §14). For an
  all-negative fixture, "pass" means the agent correctly declined the
  wrong candidates.

### Positive and negative fixtures — author both

The teams should contribute **both kinds** of fixture, because they test
different agent abilities:

- **Positive fixtures** (the default) test **recall** — strip a fact and
  check the agent recovers it. Every finding is `recover` (the implicit
  default; no `polarity` needed).
- **Negative fixtures** test **restraint** — a finding with
  `polarity: "avoid"` names a plausible-but-wrong candidate the agent
  should **not** conclude. The judge scores it `matched: "true"` when the
  agent correctly *declined* to assert it. This is the only way the
  benchmark sees **over-claiming** — concluding from insufficient
  evidence, the failure that matters most in genealogy (a wrong parent
  silently corrupts an entire upstream tree).

A single fixture may mix `recover` and `avoid` findings. Aim for the
suite as a whole to cover both — and a spread of question types (parents,
death, siblings, …), eras, and geographies via `tags`, so ten people
running tests produce diverse signal rather than ten runs of the same
question.

**Authoring a negative finding.** Cheapest form: strip a fact that live
FamilySearch genuinely can't support, where the right behavior is the
agent declining to assert it. Harder, more realistic form: pick a person
whose relatives are easily confused with similarly-named others, and make
the `avoid` finding the wrong-but-tempting candidate. Set
`polarity: "avoid"` and write the `description` to state what the agent
must NOT conclude. See spec §3.4.1.

---

## Running tests

All commands run from `eval/harness/` (where `pyproject.toml` is).

**Three equivalent ways to run these** — use whichever fits:

- **`make` targets** (from the repo root, macOS/Linux) — `make e2e-login`
  (once a day), `make e2e-preflight`, `make e2e-run TEST=<slug>`,
  `make e2e-validate TEST=<slug>` (omit `TEST` for `--all`),
  `make e2e-scratch TEST=<slug>` (hand-debug `/research`),
  `make e2e-calibrate` (maintainer only).
  `e2e-run` rebuilds the MCP server first if stale. See `make help`.
- **Windows batch files** in `eval\` — `Login.bat` (FamilySearch login, once a
  day), `CheckSetup.bat` (preflight, run first), `RunE2E.bat`,
  `ValidateFixture.bat`, `ScratchResearch.bat`,
  `RunCalibration.bat` (maintainer only). Each prompts for what it needs and
  builds the MCP server where required.
- **`uv run`** commands (shown below) from `eval/harness/` — the underlying
  cross-platform form.

### Run one fixture

```bash
cd eval/harness
uv run python -m e2e.run_e2e --test <slug>      # Windows: RunE2E.bat
```

Example:

```bash
uv run python -m e2e.run_e2e --test smith-parents-1850
```

### Run by tag

```bash
uv run python -m e2e.run_e2e --tag parents
uv run python -m e2e.run_e2e --tag 1850s
uv run python -m e2e.run_e2e --tag US-VA
```

The `--tag` filter matches against any tag dimension value. There is
no full-suite flag — scope each run with `--test` or `--tag`. A
10-fixture sweep would burn 4–10 hours and $30–100; if you genuinely
need it, drive it with a shell loop and budget accordingly.

### Useful flags

- `--skip-judge` — run the agent but skip the judge step. Useful
  for debugging the agent path without paying for grading.
- `--mcp-server-entry <path>` — override the MCP server location.
  Default: `packages/engine/mcp-server/build/index.js` in the repo.
- `--fixtures-root <path>` — point at an alternate fixtures
  directory.
- `--runlog-root <path>` — write results somewhere other than
  `eval/runlogs/e2e/`.

The full help text:

```bash
uv run python -m e2e.run_e2e --help
```

### Debugging `/research` by hand (scratch workspace — the Claude Code path)

> **Prefer Cowork + the viewer for live debugging.** The recommended way to
> watch a run unfold with structured output — research log, assertions,
> conflicts — is `make e2e-project TEST=<slug>` (Windows: `SeedProject.bat`),
> which seeds an editable project you open in **Claude Cowork** alongside the
> **Research Viewer**. See eval/README.md → "Debug a fixture interactively
> (Cowork + the viewer)". The scratch workspace below is the lighter-weight
> **Claude Code** alternative — no Cowork needed, handy for developers
> debugging `/research` routing (and the first-time `/research` validation in
> the setup checklist above).

A headless harness run can't show you *why* the agent stopped or skipped
a step — you can't watch it think or nudge it. For that, run `/research`
in an **interactive Claude Code session** against the same starting state:

```bash
make e2e-scratch TEST=<slug>      # Windows: ScratchResearch.bat
```

This seeds the fixture's `starting-research.json` / `starting-tree.gedcomx.json`
(as `research.json` / `tree.gedcomx.json`), copies the plugin skills into
`.claude/skills/`, and writes a `.mcp.json` that wires the genealogy MCP server
— all in a throwaway directory **outside the repo** (a sibling of the checkout,
so nothing pollutes it). It reuses the harness's own `build_workspace`, so the
scratch dir matches a real run. Then `make e2e-scratch` / `ScratchResearch.bat`
**cd into that dir and launch `claude` for you** (when you exit the session
you're back in your original shell). In the session:

```
# Claude Code prompts ONCE to approve the project MCP server (.mcp.json) —
# approve it, or /research has no FamilySearch tools and can't research.
# Be logged in to FamilySearch first (`make e2e-login`).
# Start WITHOUT --autonomous so you can watch it chain and nudge it:
/research <the researcher question>
# once it chains reliably, try the autonomous form the harness uses:
/research --autonomous <the researcher question>
```

(The bare `uv run python -m e2e.scratch --test <slug>` does setup only and
prints the `cd` + `claude` to run; add `--launch` to start `claude` directly.)

**You must have the MCP server built first** (`make engine-build`) — `e2e-scratch`
points `.mcp.json` at `packages/engine/mcp-server/build/index.js` by absolute
path, and refuses to run if it's missing. Without the MCP tools, `/research`
will say things like "validate_research_schema isn't available" or "the
FamilySearch tools aren't connected" and degrade to guessing — that's a missing
server, not a `/research` bug.

Skills are **copied, not symlinked** — Claude Code's skill loader resolves
copies reliably (symlinks are flaky, issue #17741), and copying is exactly what
the harness does.

Two caveats:

- The interactive session does **not** block `person_read` / `person_search` /
  `person_ancestors` the way a benchmark run does (spec §6.1). Calling them by
  hand reads the live tree — fine for debugging, but remember a real run can't,
  so don't let a hand-run "pass" via tree-reading fool you.
- The scratch dir is throwaway — re-running `make e2e-scratch` for the same slug
  just refreshes it (no flag needed).

---

## Reading results

**The easy path: run the `/interpret-e2e-result` skill** on a run log
(type it in a Claude Code session in this checkout — it's a `.claude/`
dev skill, so there's no `make`/`.bat` for it). It reads the run-log
files and explains, in plain language:

- the **verdict** (and flags a `pass` with low proof quality — "found
  it but didn't prove it"),
- the **proof-quality score** and what drove it,
- any **blocked tree-reads** (did the agent try to shortcut research?),
- whether a finding came from a **provided-documents** PDF vs. live
  research,
- the **stop reason** translated into something actionable,
- for a `partial`/`fail`, the **most likely cause** — tuned to whether
  it's the fixture's *first* run (did it research at all? hit a budget
  cap? was the evidence recoverable?) or a *regression* vs. a prior
  passing run.

The rest of this section is the field reference behind that explanation
— the manual fallback if you'd rather read the run log directly.

Each run writes four files to
`eval/runlogs/e2e/<test-id>/run-<timestamp>.*`:

| File | Content |
|------|---------|
| `run-<ts>.json` | Structured result: `verdict`, `stop_reason`, `judge_output`, `usage`, `tool_calls[]`, `blocked_tree_reads[]` |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree (what the judge graded) |
| `run-<ts>.final-research.json` | The agent's final `research.json` |

All four are committed for any **gradeable** run — verdict pass, partial, or
fail (the `run-<ts>.*` names above). A committed `fail` is retained signal (a
capability gap to retry later) and must be graded like any committed run. Only a
**skipped** run — the judge never ran, so there's no tree to grade — writes the
four files with a gitignored `scratch_<ts>.*` prefix. Fixture *validity* is
separate: only a passing run validates a fixture (§14 of the spec).

### Interpreting `verdict`

- `pass` — all `required: true` findings matched.
- `partial` — some required findings matched but not all.
- `fail` — no required findings matched.
- `skipped` — the judge didn't run (agent crashed before producing
  a tree, or `--skip-judge` was passed).

### Interpreting `stop_reason`

- `completed` — agent set `project.status == "completed"` (happy
  path; proof-conclusion fired).
- `natural_end` — SDK ended the conversation without setting
  completed (agent thought it was done, GPS may or may not be).
- `inactivity` — no agent activity for the inactivity window.
- `timeout` — wall-clock limit fired.
- `tool_cap` — hit the per-run tool-call limit.
- `cost_cap` — hit the per-run cost limit.
- `max_turns` — SDK turn limit fired.
- `error` — SDK or harness exception. Check `result.error`.

### Roll-up report

When `--tag` runs more than one fixture, the harness prints a
summary at the end:

```
E2E suite: 2/3 passed, 1 partial
  by question_type    parents 2/2  siblings 0/1
  by era              1850s 1/2    1900s 1/1
  avg cost: $4.20 / run     total cost: $12.60
  avg wall-clock: 22.5 min / run     total: 67.5 min
```

---

## Investigating failures

When a test fails (or a previously-passing test regresses):

1. **Read the transcript first.** `run-<ts>.transcript.md` shows the
   agent's reasoning + tool calls in order. Most failures are
   obvious from this — the agent stopped, looped, or made the
   wrong call.

2. **Check the final tree.** `run-<ts>.final-tree.gedcomx.json`
   shows what the agent actually built. Compare to
   `expected-findings.json` — sometimes the agent found the right
   answer but recorded it in a place the judge didn't recognize.

3. **Check the stop_reason.** If `inactivity` or `timeout`, the
   agent probably stalled; transcript will show where. If
   `tool_cap` or `max_turns`, the agent may be looping (look for
   repeated similar tool calls near the end).

4. **For regressions: diff the runlogs.** When a previously-passing
   test fails, diff the new `run-<ts>.json::tool_calls` against the
   last passing run. Each entry carries `tool`, `args`, and a
   `response_summary` (a short stringification of the FS result), so:
   - Different collection IDs touched → maybe agent took a
     different path
   - Different hit counts on the same search → FS may have
     reindexed
   - Same calls, different `response_summary` → likely an agent or
     skill regression

5. **Distinguish failure causes:**
   - **Agent reasoning regression** — different decisions on the
     same evidence. Diff `tool_calls` shows the agent making
     different choices.
   - **`/research` skill regression** — agent skips a GPS step or
     uses the wrong sub-skill. The e2e run log has no structured
     `skills_invoked` field; scan the transcript for the `Skill`
     tool-use blocks to see which sub-skills ran and in what order.
   - **Sub-skill regression** — agent calls the right sub-skill
     but it produces worse output. Compare the relevant
     `tool_calls` block to the prior run.
   - **FS data drift** — FS returned different records or hint
     counts than before. The agent is doing the right thing
     against changed inputs.
   - **Single-run jitter** — Anthropic models are non-deterministic.
     Small score deltas (one finding flipping `matched`/`partial`)
     may just be variance. Re-run before drawing conclusions.

6. **Capture what you learned.** When a fixture's behavior changes
   meaningfully, update the fixture's `README.md` with the date and
   what shifted. The committed runlogs form the audit trail; the
   README is the human-readable summary.

---

## From a noticed issue to a fix (the skill-improvement loop)

E2e tests are a **stakeholder-facing benchmark, not a regression suite** — so when
live research surfaces a *skill* problem, the durable fix is a **unit regression
test plus a `SKILL.md` edit**, measured before you adopt it. This section is that
bridge: how an issue you *notice while researching* becomes a committed fix that
can't silently come back.

> **New to this loop? Read the ELI5 walkthrough first:**
> [`e2e-testing-example.md`](e2e-testing-example.md) follows one concrete example
> — a citation missing its page/line — end to end, calling out which of **Cowork /
> Claude Code / terminal** each step happens in. The section below is the terse
> reference behind that story.

In practice you rarely catch this as a *recorded* e2e failure — teams fix skills
before the PR — so the real trigger is a **human noticing something wrong during
research in Cowork.** That is also the *easiest* fuel: the seeded project directory
**is** the research state, so the unit-test scenario is mostly already built.

The design and rationale live in
[`docs/plan/gated-skill-improvement-slice.md`](plan/gated-skill-improvement-slice.md);
this is the operational how-to. **Every step below runs today** — the gate
(`make gate-skill`, step 6), the improver's ≤3-edit budget (step 5), and the
`mine-unit-test` skill (`.claude/skills/mine-unit-test/`, step 3).

**Preconditions for the live Cowork steps (1 and 7):** be logged in to
FamilySearch (`make e2e-login`, once a day) and have the genealogy tools installed
in Cowork — build+install the `.mcpb` extension (`make mcpb`) and upload the plugin
`.zip` (`make plugin`), per `eval/README.md` → "Debug a fixture interactively
(Cowork + the viewer)". (`make engine-build` alone wires only the Claude Code
scratch path, not Cowork.)

**1. Notice the issue during research (Cowork).** Seed an editable project and
watch it in the viewer:
```bash
make e2e-project TEST=<slug>      # Windows: SeedProject.bat
```
Open the seeded `eval/e2e-project/<slug>/` in **Claude Cowork** with the Research
Viewer. When something looks wrong — a weak citation, a missed record, an
over-claim — the project state (`research.json` + `tree.gedcomx.json` + `results/`)
is right there, and that state is the raw material for step 3.

**2. Classify before you fix (the lane gate).** Not every issue is a skill-body
problem. Using the project's `results/` sidecar files (the real tool responses) and
the transcript, place the cause — this is `skill-lifecycle.md` §5's lane rule:
- **Tool defect** — the sub-skill called the right tool with the right args but it
  returned wrong/missing data (or rejected a valid payload) → an **MCP tool PR +
  vitest**, not a skill edit. (The cause list in "Investigating failures" above has
  *no* tool-defect entry, so this is the easy one to skip — don't.)
- **Eval / rubric defect** — the skill did the right thing and a stale
  rubric/fixture would ding it → a **rubric or judge-prompt** fix (start with the
  `rubric-critic` agent, step 5).
- **Record-type craft gap** — a single record type's nuance (a death-cert,
  probate, or church-record subtlety) was mishandled → fix it in **that record
  type's playbook/table, not global `SKILL.md` prose**; this loop's body edit is
  the wrong lever. (Still worth a regression test.)
- **Core doctrine** — a genuine cross-record-type behavior the prose steered wrong
  → continue this loop.

The last two lanes proceed to a unit test (a record-type fix lands in its
playbook/table; a core-doctrine fix in `SKILL.md`).

**3. Mine a unit test that exhibits the issue.** In a **Claude Code** session at
the repo root, run the **`mine-unit-test`** skill (`.claude/skills/mine-unit-test/`)
— point it at the Cowork project (`--project <dir>`) or a recorded e2e run
(`--e2e-run <dir>`), and give it your Did/Should/Gap note. It applies the lane
gate (Step 2 above), localizes to the sub-skill, carves a mid-flow scenario from
the project state, synthesizes mock fixtures from the project's `results/` sidecars
(the `log[].query` gives the args, `results/<log_id>.json` the response), and
writes a `_draft` test + scenario + fixtures under `eval/`. It's **guided
authoring** — treat the scenario carve especially as a first cut to verify.
(`mine-unit-test` is the sibling of `draft-unit-test`, which mines from a submitted
*feedback case* instead.) **Keep the test general** — it
must capture the *class* of mistake, not memorize the one scenario (a case-patch
is a regression in disguise).

**4. Run the mined test and annotate it — this is what lets the improver act.**
```bash
make eval-skill SKILL=<skill>     # runs the skill's suite, including the new test
```
Then open the CRUD UI (`make eval-ui`) and annotate the mined test's failing
dimension: in its correction `comment` (a single free-text field) write what the
skill **Did**, what it **Should** have done, and the **Gap** in the `SKILL.md`
prose between them — the same problem you spotted in step 1. This is not optional:
the `skill-improver` proposes nothing for a lone, unannotated test (its bar is "≥2
tests **OR** one human correction with a specific comment"). You already hold that
comment — write it down.

**Precondition — hold-out tests must exist before you gate.** Steps 5 and 6 assume
your pilot skill already has 2–3 hold-out tests (the improver excludes them; the
gate unions them into its no-regression check). Today only `citation`,
`search-external-sites`, `search-images`, and `validate-schema` have any (9
hold-out tests, of 343 total). If your pilot has none, that check is silently
inert — first designate 2–3 diverse, stable tests as hold-out via the CRUD UI's
Hold-out toggle. Marking a test hold-out is a grading-relevant change that flips
the skill's active run-log inactive, so do it **before** this step and let this
step's `make eval-skill` establish the fresh baseline.

**5. Audit the rubric (once), then improve the skill.** Before trusting the judge
to score the improvement loop, make sure the skill's rubric discriminates:
> **`rubric-critic`** (Claude Code subagent, `.claude/agents/rubric-critic.md`) —
> *"audit the rubric for `<skill>`."* Read-only; flags dimensions that never vary,
> flaky ones, and systematic judge-vs-human divergence. This is a **once-per-skill
> precondition** (plan §10), not a step you repeat every round — skip it if the
> skill's rubric was audited recently.

Then run the body optimizer:
> **`skill-improver`** (Claude Code subagent, `.claude/agents/skill-improver.md`) —
> *"improve `<skill>` from its eval results."* Report-only: it reads the annotated
> run-log and proposes evidence-cited `SKILL.md` edits, **capped at ≤3 ranked edits
> per round** (the edit budget). It excludes hold-out tests, routes non-body causes
> elsewhere, and refuses case-patches. **You apply the edits to the working-tree
> `SKILL.md`** — it never writes files.

Trusting the (good-in-aggregate) LLM judge to score this loop is fine **bounded
by**: the rubric was just audited; the fix must *reproduce on the old skill, then
pass on the new* (never a lone pass); the loop is iteration-capped (don't
loop-until-the-judge-is-happy — that reward-hacks the judge); and a hold-out the
improver never sees backstops it.

**6. Gate the edit (`make gate-skill`), then produce the release run.** First
apply the improver's ≤3 edits to the working-tree `SKILL.md`. Then:
```bash
make gate-skill SKILL=<skill> TEST=<mined-test-id> [DIMENSION="<failing dim>"]
```
It runs the mined test ∪ the skill's hold-out set on your **candidate** (the
working tree, edits applied), mock-backed, and compares to the **incumbent**
scores read from your **step-4 run** (the pre-edit `make eval-skill` run you
annotated — human corrections are used as the baseline). It prints a per-dimension
comparison + a **LOOKS GOOD / NEEDS YOUR EYES / INCONCLUSIVE** signal, and
**credits the fix only if the failure reproduced on the step-4 baseline and then
passed on the candidate** — an `INCONCLUSIVE` means it didn't reproduce at step 4
(jitter or a too-weak test: re-mine or drop it). Hold-out drops are flagged for you
to eyeball, never auto-rejected. The gate runs **one side, writes no run-logs, and
needs no `git`** — you decide, using generalization-by-inspection as the primary
guard. (It errors if you haven't run step 4 yet — it needs that baseline. No
hold-out tests? The no-regression half is inert — see the step-4 precondition.)

Then produce the **releasable, annotated run** the PR needs:
```bash
make eval-skill SKILL=<skill>
```
Annotate it in the CRUD UI (correct only the dimensions you disagree with). A
senior reviews these corrected grades and releases the run-log version.

**7. Verify in Cowork (sanity check).** Re-run the same research in the seeded
project (step 1) and confirm the issue is gone. Belt-and-suspenders: the **unit
test is the durable regression guard**; one live e2e run against drifting
FamilySearch data is a sanity check, not proof.

**8. Open the PR.** One skill per PR: the `SKILL.md` edit + the mined unit test
(+ scenario/fixtures) + the run-log + your annotations. A senior reviews the
corrected grades and releases the run-log version.

### Where each step runs

| Step | Tool | Runs in |
|---|---|---|
| 1 Notice | `make e2e-project` + Research Viewer | **Cowork** |
| 2 Classify | judgment + `results/` + transcript | Claude Code |
| 3 Mine | `mine-unit-test` | Claude Code (repo root) |
| 4 Run + annotate | `make eval-skill` + CRUD UI (`make eval-ui`) | Claude Code / browser |
| 5 Audit + improve | `rubric-critic`, `skill-improver` | Claude Code |
| 6 Gate | `make gate-skill` + `make eval-skill` + CRUD UI | Claude Code / browser |
| 7 Verify | `make e2e-project` | **Cowork** |
| 8 PR | git / GitHub | — |

---

## Judge calibration

The verdict on every e2e run comes from one LLM judge call. Before you
trust those verdicts, you need to know how often the judge agrees with a
human — and you establish that **offline and cheaply**, never by reading
expensive e2e runs.

This is a separate cadence from running e2e tests:

| Cadence | What runs | Cost | When |
|---|---|---|---|
| **e2e run** | `/research` vs live FamilySearch + judge | $3–10, 20–60 min | periodic / on demand |
| **judge calibration** | the judge vs committed human grades | one cheap LLM call per graded run | only when the judge prompt or model changes |

### How grades are stored

A human grade is a small annotation committed **beside the run log it grades**,
`eval/runlogs/e2e/<slug>/run-<ts>.ann.json`. Its **presence is the selection** —
there is no separate calibration-case directory and no seeder. The file carries
only the human's recall labels:

```json
{
  "annotator": "alice",
  "per_finding": { "f1": "true", "f2": "partial" },
  "proof_quality_score": 2,
  "notes": { "f2": "right burial place, year-only date — date-precision call." }
}
```

- `per_finding` (required) — `true` / `partial` / `false` per fixture finding id.
  The recall gate.
- `proof_quality_score` (optional) — `1` / `2` / `3` / `null` advisory score, only
  when the run wrote a proof summary worth grading.
- `notes` (optional) — a `{finding_id: text}` map; each note prints on that
  finding's disagreement line.
- `annotator` (optional) — git blame is the fallback.
- There is **no `verdict` field** — the per-run verdict is derived from
  `per_finding`.

### Grading a run

Run **`/grade-e2e-run`** on the run. It reads the fixture and the run's two
`final-*` siblings — **not the run log itself**, so you grade *blind* to the
judge's own calls (that independence is what makes the agreement number mean
something) — shows you each expected finding plus the agent's evidence, writes the
`.ann.json` with your labels, and self-checks that file (labels complete, keys
match the fixture's finding ids). Then commit the `.ann.json`.

You do **not** run `calibrate_judge` — not even `--dry-run`. That tool classifies
*every* annotation in the tree and is the maintainer's step (below). The skill's
self-check covers the one file you wrote.

**Grading an `avoid` finding** (negative fixtures, spec §3.4.1): the helper shows
the *absence* of the wrong candidate as the evidence. Label it `true` when that
candidate is absent or present only as a rejected hypothesis, `false` when the
agent over-claimed it.

A worked example — a deliberate human-vs-judge disagreement on a date-precision
boundary call (the judge called the burial a full match; the human downgraded it):

```json
{
  "annotator": "alice",
  "per_finding": { "f1": "true", "f2": "partial" },
  "proof_quality_score": 2,
  "notes": { "f2": "right burial PLACE (Madelia, MN) but only a year-precision date; judge called it a full match — downgraded to partial." }
}
```

### Running calibration (maintainer step)

> **This is the maintainer's step, not the contributors'.** Contributors grade
> their runs with `/grade-e2e-run` and commit — they never run `calibrate_judge`.
> One person (the maintainer) runs it periodically once a batch of grades exists:
> `--dry-run` to classify the committed annotations, then the full calibration
> below — a judge API call per graded run, meaningful only across the whole
> collected set.

```bash
cd eval/harness
uv run python -m e2e.calibrate_judge            # Windows: RunCalibration.bat
```

It reports **per-finding recall agreement** (the headline + the gate),
proof-quality agreement (advisory), and a **per-slug breakdown**, and lists every
disagreement (with any notes).

- **Target: ≥80% per-finding recall agreement** — roughly human inter-rater
  agreement, and the gate. Per-finding is the metric: per-run verdicts are
  dominated by easy passes, and the per-run verdict is now derived (not
  independently authored), so it isn't reported.
- **Proof-quality agreement is reported but does not gate.** It's the noisier
  axis — trust it only once the set has hard proof cases (a strong proof, a
  single-source over-claim, a missing conflict resolution).
- **The disagreements are the signal, not the headline percent.** A systematic
  miss (e.g. the judge always under-calls a date-variation match) is a
  judge-prompt fix.
- **The per-slug breakdown** shows whether one fixture is dominating the number;
  if it starts to, that's the trigger to switch to a per-slug macro-average (see
  the calibration plan).
- Re-run after any change to `judge_prompt.md` or the judge model. You do **not**
  re-run e2e tests for a judge change — that's what this loop is for.

### Team workflow: who does what

The work splits in two. **Contributors** (the genealogist + developer
teams) author fixtures, run them, and grade the results into per-run
annotations. **The maintainer** (one person) runs the actual judge calibration
*after* enough grades are collected and tunes the judge prompt. Running
e2e and collecting graded runs **before** the judge is calibrated is the
intended bootstrap — you don't need a calibrated judge to start grading.

**Each contributor:**

1. **Check setup** — `CheckSetup.bat` (or `uv run python -m e2e.preflight`).
   Confirms FS login, built MCP server, API key, and harness deps are all
   in place *before* you spend time and money on a run.
2. **Author a fixture** — `/author-e2e-fixture` from a PID. Author both
   **positive** fixtures (recover stripped facts) and **negative** ones
   (the agent should decline a wrong candidate) — see "Creating a new e2e
   test" §3 and "Negative fixtures" below. Run `ValidateFixture.bat`.
3. **Run the fixture** — `RunE2E.bat` (or `uv run python -m e2e.run_e2e
   --test <slug>`). Commit the fixture and its passing run log.
4. **Read the result** — the `/interpret-e2e-result` skill explains the
   verdict and proof-quality score.
5. **Grade it** — run `/grade-e2e-run` on the run (see "Grading a run" above)
   and commit the `run-<ts>.ann.json`. You label each finding *blind* to the
   judge's own grades, and the skill self-checks the file before you commit.
   **Contributors never run `calibrate_judge`** — not even `--dry-run`.
   Classification and the full agreement sweep are the maintainer's step.
   CI enforces same-PR grading: the `check-e2e-fixtures` action **blocks** the
   PR if a run log you added produced a final tree but has no committed
   `.ann.json` sibling (a treeless crash/skip run is exempt — nothing to grade).

**The maintainer**, once enough grades are collected, runs `RunCalibration.bat`
(full `calibrate_judge` — the only step that calls the judge API at scale), reads
the per-finding agreement and every disagreement, and tunes
`eval/harness/e2e/judge_prompt.md`. The annotation *is* the human grade,
arrived at blind — there is no separate annotation UI, and it is not a
correction of the judge's own labels.

---

## Costs and pacing

- A typical run: 20–60 minutes wall-clock, $3–10 API cost.
- A 10-fixture sweep (shell loop or wide `--tag`): 4–10 hours,
  $30–100. Don't gate PRs on this — run on demand, monthly cadence,
  or after substantial agent / skill changes.
- A per-run safety limit (wall-clock, turns, tool calls, cost) stops a
  runaway agent before it burns the whole budget. It's a harness default
  in `FixtureCaps` (`eval/harness/e2e/orchestrator.py`); tune it there if
  real runs consistently hit a limit.

---

## Related docs

- [`docs/plan/e2e-skills.md`](plan/e2e-skills.md) — design rationale,
  the three-cadence model, and the remaining build work
- [`docs/plan/gated-skill-improvement-slice.md`](plan/gated-skill-improvement-slice.md)
  — the design behind "From a noticed issue to a fix": mining unit tests from
  noticed failures (E), the gate (A), and the improver edit budget (B)
- [`docs/skill-lifecycle.md`](skill-lifecycle.md) — the full authoring →
  test → improve → release loop the unit-test half plugs into
- the `skill-improver` and `rubric-critic` agents — `.claude/agents/`
- [`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the
  authoritative test format and harness contract
- [`docs/specs/research-schema-spec.md`](specs/research-schema-spec.md)
  — `research.json` schema, relevant when authoring
  `starting-research.json`
- [`docs/specs/simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md)
  — `tree.gedcomx.json` schema, relevant when authoring
  `starting-tree.gedcomx.json`
- [`eval/CLAUDE.md`](../eval/CLAUDE.md) — eval framework
  conventions (unit tests; e2e shares the runlog discipline)
- [`docs/alpha-user-guide.md`](alpha-user-guide.md) — what alpha testers do
  (research in the hosted web app; they do not author fixtures)
- [`docs/alpha-feedback-example.md`](alpha-feedback-example.md) — one alpha
  report followed end to end into a committed regression test
- [`packages/engine/plugin/skills/research/SKILL.md`](../packages/engine/plugin/skills/research/SKILL.md)
  — the `/research` skill that e2e tests invoke
