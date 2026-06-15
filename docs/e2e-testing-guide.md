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
2. **Manually validate `/research`.** In normal Claude Code use,
   exercise `/research <question>` on three or four real research
   questions (no harness, no fixture). Confirm:
   - The skill chains through GPS sub-skills (question-selection →
     research-plan → search-records → record-extraction → …) without
     skipping major steps.
   - It reaches `proof-conclusion` or at least makes credible
     progress toward an answer.
   - Refine `packages/engine/plugin/skills/research/SKILL.md` if the routing cues
     don't trip cleanly. Iterate until "reasonably reliable" — not
     perfect, just good enough that future fixture failures will
     reflect agent capability rather than primer bugs.
3. **Eyeball a candidate PID.** Use `person_read` (with
   `relatives=true sourceDescriptions=true`) against a well-researched
   person (acceptance criteria below). Check JSON size; pick a different
   PID if unwieldy.
4. **Author the first fixture.** Run `/author-e2e-fixture` and give it
   the PID — it reads the tree via `person_read`, you pick what to
   strip, and it writes the five files. (You don't need a finished
   research project; that's the secondary path. Or follow §4 in
   "Creating a new e2e test" to author by hand.) Keep it focused (one
   question, 1–5 expected findings). Then **run the stripping linter**
   (`uv run python -m e2e.validate_fixture <slug>`; Windows:
   `ValidateFixture.bat`) and resolve any `WARN` before committing — see
   "Creating a new e2e test" §5.
5. **Run the first e2e test:**
   ```bash
   cd eval/harness
   uv run python -m e2e.run_e2e --test <slug>      # Windows: RunE2E.bat
   ```
6. **Seed and grade a calibration case.** Seed it from this run with
   `uv run python -m e2e.seed_calibration_case --test <slug> --who <you>`
   (Windows: `SeedCalibrationCase.bat`), fill in the `human` block, and
   validate it parses with `uv run python -m e2e.calibrate_judge
   --dry-run`. Commit the case file. **Running the full calibration** (no
   `--dry-run`) — reading agreement and tuning `judge_prompt.md` — is the
   maintainer's step, done once a batch of cases exists, not per
   contributor. See "Judge calibration" below.
7. **Finalize the spec** at `docs/specs/e2e-test-spec.md` based on
   what the first run actually needed (drop the "Provisional" note).
8. **Add a second fixture** with non-overlapping tags. Verify both
   run without code changes.

After that, fixture authoring becomes routine.

---

## Prerequisites

Before running any e2e test:

1. **FamilySearch login.** Log in via the `login` MCP tool so
   `~/.familysearch-mcp/tokens.json` exists. Refresh tokens last
   24h; if your run is longer than that or the tokens expire mid-run
   the harness will fail mid-flight.

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

> **Where these skills live.** `author-e2e-fixture` and `interpret-e2e-result`
> are repo-local dev tooling under `.claude/skills/` (alongside `compare-state`
> and `draft-unit-test`), **not** part of the shipped Cowork plugin. Claude Code
> picks them up automatically when you work in this checkout, so the `/`-commands
> below just work. See [`docs/plan/e2e-skills.md`](plan/e2e-skills.md) for why
> they're a distinct class from the research skills.

**If you're a genealogist**, run the `/author-e2e-fixture` skill. The
primary path starts from a FamilySearch person ID: give it a PID and it
reads that person's well-researched tree via `person_read`, you pick a
focused subset to strip (the "answer"), and it strips that subset,
records it as expected findings, and writes the five files into a
`<slug>/` subfolder of your working directory. No prior research project
is needed — the tree on FamilySearch is the ground truth. (A secondary
path converts a research project you just finished, reusing its
`proof_summaries`.) Move the `<slug>/` folder into
`eval/tests/e2e/<slug>/` to land it.

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
  (>200 sources, deep ancestor branches). If the `person_read` output
  is over ~500 KB, narrow scope or pick someone else.
- **Clear research question.** You can phrase a natural-language
  question whose answer is anchored in attached evidence (e.g.,
  "Who were John Smith's parents?", "When did Mary Jones die?").
- **Stable.** Older records, contributed-and-stable persons, not
  ones with active editing wars.

### 2. Eyeball the JSON

Read the unstripped tree before committing to it, via the `person_read`
MCP tool (in Claude Code with the genealogy MCP server running, and
logged in via the `login` tool):

```text
person_read personId=<the-pid> relatives=true sourceDescriptions=true
```

It returns simplified GEDCOMX (persons, relationships, sources) — the
`tree.gedcomx.json` shape. Check JSON size, source count, relationship
depth. If it's unwieldy, narrow scope or pick a different PID.

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

### 4. Author the fixture files

Create the directory:

```
eval/tests/e2e/<slug>/
  fixture.json
  starting-research.json
  starting-tree.gedcomx.json
  expected-findings.json
  README.md
```

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
  "caps": {
    "wall_clock_seconds": 3600,
    "inactivity_seconds": 600,
    "tool_calls": 200,
    "max_turns": 100,
    "max_cost_usd": 15
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
- `caps` are per-fixture stop-condition limits. Tune as you learn
  realistic bounds. The harness enforces all of them.

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
— there is no minimal template. Start from the live `person_read`
output and delete the persons / relationships / facts / sources
that correspond to your research question's answer.

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

**Windows users:** double-click the batch files in `eval\` instead of
typing `uv run` commands — `CheckSetup.bat` (preflight, run this first),
`RunE2E.bat` (run a fixture), `ValidateFixture.bat` (stripping linter),
`SeedCalibrationCase.bat` (grade a result into a calibration case), and
`RunCalibration.bat` (judge calibration — **maintainer only**). Each
prompts for what it needs and builds the MCP server first where required.
The `uv run` commands below are the cross-platform equivalents.

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

---

## Reading results

**If you're a genealogist**, run the `/interpret-e2e-result` skill on
a run log. It explains the verdict and stop reason in plain language,
compares expected vs found findings, names the most likely cause
(agent regression, FS data drift, single-run jitter, etc.), and points
you at the relevant transcript section.

The rest of this section is the field reference behind that
explanation.

Each run writes four files to
`eval/runlogs/e2e/<test-id>/run-<timestamp>.*`:

| File | Content |
|------|---------|
| `run-<ts>.json` | Structured result: `verdict`, `stop_reason`, `judge_output`, `usage`, `tool_calls[]` |
| `run-<ts>.transcript.md` | Readable transcript of the agent's turns |
| `run-<ts>.final-tree.gedcomx.json` | The agent's final tree (what the judge graded) |
| `run-<ts>.final-research.json` | The agent's final `research.json` |

All four are committed.

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
- `inactivity` — no agent activity for the inactivity cap window
  (default ~10 min).
- `timeout` — wall-clock cap fired (default 60 min).
- `tool_cap` — hit the per-run tool-call cap (default 200).
- `cost_cap` — hit the per-run cost cap (default $15).
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

## Judge calibration

The verdict on every e2e run comes from one LLM judge call. Before you
trust those verdicts, you need to know how often the judge agrees with a
human — and you establish that **offline and cheaply**, never by reading
expensive e2e runs.

This is a separate cadence from running e2e tests:

| Cadence | What runs | Cost | When |
|---|---|---|---|
| **e2e run** | `/research` vs live FamilySearch + judge | $3–10, 20–60 min | periodic / on demand |
| **judge calibration** | the judge vs a frozen, hand-graded set | one cheap LLM call per case | only when the judge prompt or model changes |

### The calibration set

The set is a **directory** of per-file cases at
`eval/tests/e2e/calibration/cases/` — one JSON case per file, named
`<slug>-<who>.json`. One file per fixture/grader means many people
contribute without conflicting on a shared file. (There is no single
monolithic `cases.json`.) Each case pins a real
`(research_question, expected_findings, final_tree, final_research)`
alongside the **human's** labels: a per-run `verdict`, a per-finding
`matched` label, and an optional `proof_quality_score`. The exact shape
is in the module docstring of `eval/harness/e2e/calibrate_judge.py`.

You don't hand-author these from scratch — you **seed each from a real
run** and then fill in the human grades:

```bash
cd eval/harness
# 1. Seed a case stub from a fixture's latest run (judge's grades
#    pre-filled, human block blank). Windows: SeedCalibrationCase.bat
uv run python -m e2e.seed_calibration_case --test <slug> --who <your-name>
# 2. Open the written file under eval/tests/e2e/calibration/cases/ and fill
#    in the `human` block — compare the agent's tree to expected-findings.
# 3. Validate the set parses (no API calls):
uv run python -m e2e.calibrate_judge --dry-run
```

A stub with an unfilled `human` block fails `--dry-run` loudly — that's
the reminder to grade it.

### Running calibration (maintainer step)

> **This is the maintainer's step, not the contributors'.** Contributors
> seed and grade calibration cases and stop at `--dry-run` (validation
> only). One person runs the full calibration below once a batch of cases
> exists, because it makes a judge API call per case and the result only
> means something across the whole collected set.

```bash
cd eval/harness
uv run python -m e2e.calibrate_judge            # Windows: RunCalibration.bat
```

It reports **per-finding recall agreement** (the headline), per-run
verdict agreement, proof-quality agreement (advisory), and lists every
disagreement.

- **Target: ≥80% per-finding recall agreement** — roughly human
  inter-rater agreement, and the gate. Per-finding (not per-run) is the
  metric: per-run verdicts are dominated by easy passes and inflate the
  number, while per-finding `matched` calls (especially
  `partial`-boundary ones) are where the judge earns its keep.
- **Proof-quality agreement is reported but does not gate.** It's the
  noisier axis — trust it only once the set has hard proof cases (a
  strong proof, a single-source over-claim, a missing conflict
  resolution).
- **The disagreements are the signal, not the headline percent.** A
  systematic miss (e.g. the judge always under-calls a date-variation
  match) is a judge-prompt fix.
- Re-run after any change to `judge_prompt.md` or the judge model. You do
  **not** re-run e2e tests for a judge change — that's what this loop is
  for.

### Team workflow: who does what

The work splits in two. **Contributors** (the genealogist + developer
teams) author fixtures, run them, and grade the results into calibration
cases. **The maintainer** (one person) runs the actual judge calibration
*after* enough cases are collected and tunes the judge prompt. Running
e2e and collecting graded cases **before** the judge is calibrated is the
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
5. **Grade it into a calibration case** — `SeedCalibrationCase.bat`, then
   fill in the `human` block. *This is the grade correction:* where you
   disagree with the judge, your human label captures it. Validate it
   parses with `uv run python -m e2e.calibrate_judge --dry-run`, then
   commit your `<slug>-<who>.json`. **Contributors stop at `--dry-run`** —
   do **not** run full `calibrate_judge` (that makes API calls and is the
   maintainer's step).

   A worked example to copy lives at
   `eval/tests/e2e/calibration/cases/EXAMPLE-kenneth-quass-death.json` —
   it shows a filled `human` block and a deliberate human-vs-judge
   disagreement. (`EXAMPLE*` files are skipped by the calibration runner.)

**The maintainer**, once enough cases are collected, runs
`RunCalibration.bat` (full `calibrate_judge` — this is the only step that
calls the judge API at scale), reads the per-finding agreement and every
disagreement, and tunes `eval/harness/e2e/judge_prompt.md`. No separate
annotation UI or `.ann` files — the calibration case *is* the corrected
grade.

---

## Costs and pacing

- A typical run: 20–60 minutes wall-clock, $3–10 API cost.
- A 10-fixture sweep (shell loop or wide `--tag`): 4–10 hours,
  $30–100. Don't gate PRs on this — run on demand, monthly cadence,
  or after substantial agent / skill changes.
- The harness enforces per-run caps via `fixture.json::caps`
  (`wall_clock_seconds`, `tool_calls`, `max_cost_usd`, etc.) so a
  runaway agent can't burn the whole budget. Tune caps per fixture
  as you learn what reasonable bounds are.

---

## Related docs

- [`docs/plan/e2e-skills.md`](plan/e2e-skills.md) — design rationale,
  the three-cadence model, and the remaining build work
- [`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md) — the
  authoritative test format and harness contract
- [`docs/specs/gps-test-spec.md`](specs/gps-test-spec.md) —
  alternate "tests derived from published GPS proof statements"
  approach, held for future work
- [`docs/specs/research-schema-spec.md`](specs/research-schema-spec.md)
  — `research.json` schema, relevant when authoring
  `starting-research.json`
- [`docs/specs/simplified-gedcomx-spec.md`](specs/simplified-gedcomx-spec.md)
  — `tree.gedcomx.json` schema, relevant when authoring
  `starting-tree.gedcomx.json`
- [`eval/CLAUDE.md`](../eval/CLAUDE.md) — eval framework
  conventions (unit tests; e2e shares the runlog discipline)
- [`packages/engine/plugin/skills/research/SKILL.md`](../packages/engine/plugin/skills/research/SKILL.md)
  — the `/research` skill that e2e tests invoke
