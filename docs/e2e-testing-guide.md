# E2E Testing Guide

Practical instructions for creating and running e2e tests.

For the test format specification, see
[`docs/specs/e2e-test-spec.md`](specs/e2e-test-spec.md). For the
design rationale, see the approved plan at
`~/.claude/plans/1-agreed-2-agreed-compiled-kite.md`.

---

## What e2e tests are

An e2e test snapshots a real well-researched FamilySearch person's
tree, strips a focused subset of the information (the "answer"), and
asks the agent — via the `/research --autonomous` entry point — to
recover what was removed. The judge compares the agent's final
`tree.gedcomx.json` against the committed `expected-findings.json`
and reports `pass` / `partial` / `fail`.

E2e tests are a **stakeholder-facing benchmark**, not a regression
suite. They demonstrate how often (and on what kinds of questions)
the agent can autonomously complete the full GPS flow. Per-PR
regression coverage is handled by unit tests in `eval/tests/unit/`.

E2e runs are **expensive**: one fixture is typically 20–60 minutes
of wall-clock and $3–10 in API costs. Run one at a time.

---

## First-time setup checklist

If you're standing up the e2e suite for the first time, work through
this in order. Each step gates the next.

1. **Verify prerequisites** (next section) — FS auth, MCP server
   built, Python harness installed.
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
3. **Eyeball a candidate PID.** Use `tree_read` against a
   well-researched person (acceptance criteria below). Check JSON
   size; pick a different PID if unwieldy.
4. **Author the first fixture.** Run `/author-e2e-fixture` in a
   working folder containing a finished research project, or follow
   §4 in "Creating a new e2e test" if working by hand. Keep it
   focused (one question, 1–5 expected findings).
5. **Run the first e2e test:**
   ```bash
   cd eval/harness
   uv run python -m e2e.run_e2e --test <slug>
   ```
6. **Sanity-check the judge.** Read the committed transcript and
   final tree. Compare to the judge's verdict. If they disagree,
   refine `eval/harness/e2e/judge_prompt.md` before adding more
   fixtures.
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
primary path converts a research project you just finished into a
fixture: it snapshots the resolved state, strips the answer from the
tree, records what was stripped as expected findings, and writes the
five files into a `<slug>/` subfolder of your working directory.
Move that folder into `eval/tests/e2e/<slug>/` to land it.

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
  (>200 sources, deep ancestor branches). If the `tree_read` output
  is over ~500 KB, narrow scope or pick someone else.
- **Clear research question.** You can phrase a natural-language
  question whose answer is anchored in attached evidence (e.g.,
  "Who were John Smith's parents?", "When did Mary Jones die?").
- **Stable.** Older records, contributed-and-stable persons, not
  ones with active editing wars.

### 2. Eyeball the JSON

Read the unstripped tree before committing to it:

```bash
# In Claude Code with the genealogy plugin loaded
tree_read PID=<the-pid>
```

Check JSON size, source count, relationship depth. If it's
unwieldy, narrow scope or pick a different PID.

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
    "judge": "claude-haiku-4-5-20251001"
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
    "objective": "Who were John Smith's parents?",
    "subject_person_ids": ["ABCD-123"],
    "status": "in_progress",
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
  "proof_summaries": []
}
```

- `project.status` must be `"in_progress"` (not `"completed"`).
- `researcher_profile.narration_guidance` must be `"concise"` so
  narration style doesn't vary across runs.
- All array fields start empty — the agent does the work from a
  clean slate.

#### `starting-tree.gedcomx.json`

The unstripped tree per `simplified-gedcomx-spec.md`, with the
answer information removed. Structure varies by what you stripped
— there is no minimal template. Start from the live `tree_read`
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
- `expected-findings.json` describes findings that are genuinely
  absent from `starting-tree.gedcomx.json` — re-read the stripped
  tree to confirm.
- The research question is answerable in natural-language form
  (avoid "find the source at ARK 1:1:XXXX" — too literal).

---

## Running tests

All commands run from `eval/harness/` (where `pyproject.toml` is).

### Run one fixture

```bash
cd eval/harness
uv run python -m e2e.run_e2e --test <slug>
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
   last passing run. The FS responses are summarized inline, so:
   - Different collection IDs touched → maybe agent took a
     different path
   - Different hit counts on the same search → FS may have
     reindexed
   - Same calls, different results → likely an agent or skill
     regression

5. **Distinguish failure causes:**
   - **Agent reasoning regression** — different decisions on the
     same evidence. Diff `tool_calls` shows the agent making
     different choices.
   - **`/research` skill regression** — agent skips a GPS step or
     uses the wrong sub-skill. Check `skills_invoked` order in the
     transcript.
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
