---
name: mine-unit-test
description: Mine a first-cut regression unit test, scenario, and MCP
  fixtures from a REAL research failure — one a genealogist noticed live
  in Claude Cowork, or a recorded end-to-end (e2e) run that missed a
  finding. Use when the user says "mine a unit test from this research
  issue", "turn this Cowork problem into a test", "make a regression test
  from this e2e miss", or "capture what the citation skill did wrong here".
  Invoke as `/mine-unit-test` (it asks what it needs) or with
  `--skill <name>`, `--project <dir>`, or `--e2e-run <dir>`. Writes a
  DRAFT test JSON, scenario, and MCP fixtures into eval/; the user refines
  them via the CRUD UI before committing. NOT for a submitted feedback
  case (use draft-unit-test) and NOT for authoring an e2e fixture (use
  author-e2e-fixture).
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# mine-unit-test

Turns a **real research failure** into a regression unit test — the "mine"
step of the skill-improvement loop
([`docs/e2e-testing-guide.md` → "From a noticed issue to a fix"](../../../docs/e2e-testing-guide.md),
walked through in [`docs/e2e-testing-example.md`](../../../docs/e2e-testing-example.md)).
Output is a **first cut** the user refines via the CRUD UI at `eval/app/`.

**This is guided authoring, not a generator.** Three steps need human
judgment and you should say so as you go: deciding it's even a *skill*
problem (Step 1), pinning *which* sub-skill (Step 2), and carving the
*mid-flow* scenario the sub-skill actually saw (Step 5). Propose a draft;
the user fixes it.

**Sibling to `draft-unit-test`.** That skill mines from a submitted
*feedback case* (a `.feedback-repo-root` case directory). This one mines
from a *live or recorded research project*. They emit the **same** test
format (`docs/specs/unit-test-spec.md` is the authority) but read
different inputs — don't run this one inside a feedback-case directory.

## Where the failure comes from — two inputs

- **Cowork (primary).** A research project directory the genealogist was
  working in when they noticed the problem — `research.json` +
  `tree.gedcomx.json` + a `results/` folder of saved tool responses. For a
  fixture-debugging session this is `eval/e2e-project/<slug>/` (seeded by
  `make e2e-project`, which writes only `research.json` + `tree.gedcomx.json`);
  for real research it's the genealogist's own Cowork project folder. The
  `results/` sidecars appear only once searches have actually run
  (`research_append` persists one per search) — which, by the time a failure is
  noticed mid- or post-research, has happened. Those populated sidecars make
  fixtures nearly mechanical (Step 6), so this path is the easy one; a
  seeded-but-never-run project has an empty `results/` and falls to the
  placeholder rule (Decision rules).
- **Recorded e2e run (secondary).** A committed run under
  `eval/runlogs/e2e/<slug>/` (`run-<ts>.final-tree.gedcomx.json`,
  `…final-research.json`, `run-<ts>.transcript.md`, `run-<ts>.json`), plus
  the fixture's `eval/tests/e2e/<slug>/expected-findings.json`. Here the
  failure is a `required: true` finding missing from the final tree, and
  localization leans on `/interpret-e2e-result` (Step 2).

## Invocation

```
/mine-unit-test                         # asks you what it needs
/mine-unit-test --project <dir>         # Cowork path: a research project folder
/mine-unit-test --e2e-run <runlog-dir>  # recorded path: eval/runlogs/e2e/<slug>/
/mine-unit-test --skill <name>          # skip the "which sub-skill?" question
```

Run it from a **Claude Code session at the `cowork-genealogy` repo root**
(the Code tab, or `claude` in a terminal) — not inside the project folder.
Outputs always land under the repo's `eval/`; let `$REPO` denote the repo
root (your current working directory).

## Steps

### 1. Get the issue, then classify it — the lane gate (do this first)

Before touching a test, you need two things from the user and one decision.

**Get the human's description of what went wrong**, in three parts
("Did / Should / Gap") — ask for it if they haven't said it:

> **Did:** what the skill actually produced.
> **Should:** what it should have produced.
> **Gap:** which SKILL.md guidance is missing, wrong, or ignored.

This is the single most important input — it becomes the test's
`judge_context` (Step 7) and the human correction the improver needs later.

**Then classify — is this even a skill-body problem?** Using the project's
`results/` sidecars (Cowork) or the run's `tool_calls[]` / transcript
(recorded), place the cause. This is `docs/skill-lifecycle.md` §5's lane
rule, applied at mining time:

| What you find | Lane | Action |
|---|---|---|
| The sub-skill called the right tool with the right args, but the **tool** returned wrong/missing data (check the raw `results/` payload) | Tooling defect | **Stop.** This is an MCP-tool PR + vitest, not a unit test. |
| The skill did the right thing and only a stale **rubric/fixture** would fault it | Eval defect | **Stop.** Route to the rubric / judge-prompt review (`rubric-critic`). |
| One **record type's** nuance was mishandled (a death-cert / probate / church subtlety) | Record-type craft gap | Mine a test, but the fix belongs in that record type's playbook/table, **not** global prose. |
| The skill's prose genuinely steered the model wrong, across record types | Core doctrine | Mine a test; the fix is a SKILL.md edit. |

Only the last two lanes continue. If it's a tool or eval defect, say so
plainly and stop — mining a unit test for a tool bug is the exact
anti-pattern the lane rule exists to prevent.

### 2. Localize to the sub-skill

You need the ONE plugin sub-skill that owns the mistake — the test's
`test.skill`. Plugin skills live at
`$REPO/packages/engine/plugin/skills/<name>/`.

- **`--skill` given** → use it.
- **Cowork path** → the genealogist usually knows which step misbehaved
  (they watched it). Confirm the name against the skill list; if unsure,
  read `research.json`'s recent `log[]` entries and the sub-skill's
  `allowed-tools` to match the tools that were used.
- **Recorded path** → run (or have the user run) `/interpret-e2e-result`
  on the run first; it names the most likely cause. Only two causes are
  body-testable here:
  - **sub-skill regression** or **agent-reasoning regression** → mine a
    test for the implicated sub-skill (scan `run-<ts>.transcript.md` for
    the `Skill` tool-use blocks — the e2e run log has no structured
    `skills_invoked` list).
  - **`/research` routing** — split by half. **"Picked the wrong sub-skill"**
    is a *triggering* miss → route to `make optimize-skill` (the description
    optimizer), not a body test. **"Skipped a GPS step"** is an
    orchestrator-body / core-doctrine issue — the description optimizer
    *cannot* fix it (it tunes the description only, never runs the skill) →
    route to a `research`-body (orchestrator) `SKILL.md` edit; don't send it to
    the optimizer and don't discard it. **FS data drift / single-run jitter**
    → discard; there's nothing to fix.

If you cannot confidently name one sub-skill, stop and ask the user.

### 3. Read the rubric and a reference test

Read `$REPO/eval/tests/unit/<skill>/rubric.md` for the grading dimensions
you're targeting (you never write the rubric — it's senior-owned). Read one
existing `$REPO/eval/tests/unit/<skill>/*.json` to match its shape and
conventions.

### 4. Pick a slug and the test id

Derive a short kebab-case `<slug>` from the issue (e.g.
`citation-missing-locator`). The test id is
`ut_<skill_with_underscores>_<NNN>`, where `<NNN>` is the next unused
integer for that skill — scan `$REPO/eval/tests/unit/<skill>/*.json`, take
the highest, increment, zero-pad to three digits.

### 5. Carve the mid-flow scenario — the hard step

A unit test replays the sub-skill against a **starting state**, then judges
what it produces. The trap: the project you have is the state *after* the
failure, so the bad output is already in it. You must reconstruct the state
the sub-skill saw **just before it went wrong**, and let the test re-run it.

Write three files under `$REPO/eval/fixtures/scenarios/<slug>/`:

- `README.md` — one paragraph: the scenario and the bug it captures.
  Reference the source (project folder or e2e slug) for traceability. No PII.
- `research.json` — a **minimal** project state containing only the
  entities the sub-skill needed as *input*, with its bad *output* removed.
  (Example: for a bad citation, keep the source the skill was citing and
  the search log entry that found it; remove the flawed citation the skill
  wrote.) Best-effort PII scrub — names → `Person A`/`Person B`, dates →
  decade, places → county/country. **Keep it schema-clean** — do NOT add a
  top-level `_draft` (or any extra top-level key): the harness validates the
  scenario before running, and a stray top-level key makes the test abort as
  *not-runnable* with nothing to grade.
- `tree.gedcomx.json` — minimal simplified-GedcomX with the same scrub;
  only the persons/relationships/sources the failure used (also schema-clean).

Put the caveats — "the PII scrub is best-effort, review before committing" and
"verify this carve is the pre-failure state" — in the scenario **`README.md`**
(prose, not schema-validated) and in your Step 8 printout. **Say clearly that
this carve is a best guess**; getting "the state just before the failure"
exactly right is judgment, and the user verifies it in the CRUD UI.

### 6. Emit the MCP fixtures

The scenario is mock-backed: every tool the sub-skill calls must be served
from a fixture at `$REPO/eval/fixtures/mcp/<name>.json`
(`{tool, description, args, response}`; `args` is a match predicate).

- **Cowork path (clean).** For each relevant search in
  `research.json`'s `log[]`, the entry's `query` object gives the fixture
  **args**, and its `results_ref` points at `results/<log_id>.json` whose
  `payload` is the **verbatim tool response** — copy it into the fixture's
  `response`. (A nil search has `results_ref: null` — no payload; represent
  it as an empty-results response.)
- **Recorded path.** The committed run's `tool_calls[]` gives tool + args +
  a truncated `response_summary` — enough for a fixture's *shape* but not the
  full `response` body. Full payloads live only in `run-<ts>.session.jsonl`,
  which is **usually absent** from committed runs. So: if `session.jsonl` is
  present, copy the verbatim payload and trim it; otherwise reconstruct the
  `response` from `response_summary` as best you can, and where the real
  payload can't be recovered, fall to the placeholder-fixture path (Decision
  rules) and flag it.
- **Args predicate:** use a distinctive substring with the `~` prefix for
  case-insensitive match (e.g. `"givenName": "~Patrick"`), matching the
  existing convention (see `eval/fixtures/mcp/record-search-*.json`).
- **Naming:** `<tool-short>-<distinctive-suffix>` (drop the
  `mcp__genealogy__` prefix, underscores → hyphens; suffix from a place /
  name / query keyword).
- **Dedup:** Glob `$REPO/eval/fixtures/mcp/` first; if an existing
  fixture's predicate already covers the call, reuse it (don't write a
  duplicate). If unsure, write a `-2`/`-3` variant and let the user
  consolidate.
- **Skip the six live tools** — `validate_research_schema`,
  `research_log_append`, `research_append`, `tree_edit`, `tree_correct`, and
  `project_context`. Each runs the real implementation against the workspace
  (`mock_mcp.py`'s `LIVE_TOOLS`), so it needs no fixture — and its response
  isn't in `results/`, so don't hunt for a `payload` to copy for a
  `research_append`/`tree_edit` call. Every *other* (network) tool the
  sub-skill calls needs one.

### 7. Emit the test JSON

Write `$REPO/eval/tests/unit/<skill>/<slug>.json`, matching the shape of the
reference test you read in Step 3:

```json
{
  "test": {
    "id": "ut_<skill_with_underscores>_<NNN>",
    "skill": "<skill>",
    "name": "<one-line summary of the Should>",
    "type": "positive",
    "description": "<2-3 sentences: the failure mode and what the skill should do instead>",
    "tags": ["from-cowork", "<slug>", "re-invoke-safe"]
  },
  "input": {
    "user_message": "<the request that triggered the sub-skill>",
    "scenario": "<slug>"
  },
  "judge_context": [
    "<one concrete, checkable bullet per behavior from the Should — grounded, not a preferred answer>"
  ]
}
```

- **Keep it schema-clean** — no top-level `_draft` block (nothing in the
  harness or CRUD UI reads it, and any unknown top-level key makes
  `make eval-skill` skip the test as schema-invalid). It's a *draft* because you
  say so in the Step 8 printout, not because of a marker in the file. The
  review reminders that would have gone in the Step 8 printout are printed to the
  user in Step 8.
- Use `"from-e2e"` instead of `"from-cowork"` on the recorded path.
- **Leave `holdout` unset.** A mined test is *evidence* — the improver
  forms its edit from it, so it must NOT be a hold-out (`docs/plan/gated-skill-improvement-slice.md`
  §8.4). Hold-outs are a separate 2-3 tests the improver never sees.
- **Generalize, don't memorize.** `judge_context` must describe the
  *class* of mistake (e.g. "a census citation must include a locator that
  relocates the record"), not this one scenario's exact strings. A test
  that only catches the Schuster case is a regression in disguise. Keep the
  criteria **neutral** — grade the reasoning, never a preferred answer.
- `judge_context` is background for the judge, **not** a scored dimension
  (the senior-owned rubric is what's scored). Never write `rubric.md`; if a
  new dimension is needed, say so in the Step 8 printout (not the test JSON).

### 8. Print the outputs and the mandatory next step

As the **last thing**, print to the session:

1. The absolute path of every file written (test, scenario dir, each
   fixture) — copy-paste friendly.
2. **The run + annotate step — this is not optional.** The test + scenario are
   schema-clean, so they run as-is. A brand-new test does nothing for the
   improver until it is run and its failing dimension is annotated with the
   Did/Should/Gap comment. Print:
   ```
   # 1. run the mined test (from the repo root)
   make eval-skill SKILL=<skill>
   # 2. open the CRUD UI, find this test's failing dimension, and paste the
   #    Did / Should / Gap comment on it:
   make eval-ui
   ```
   Say why: the `skill-improver` proposes nothing from a lone, unannotated
   test — its bar is "≥2 tests OR one human correction with a specific
   comment." The comment you gathered in Step 1 is that correction.
3. **This is a first cut — verify these before you commit** (the reminders that
   don't live in the file):
   - The scenario is the state the sub-skill saw **before** the failure (the
     carve, Step 5) — the part most likely to need your hand.
   - `judge_context` describes the **class** of mistake, not this one transcript.
   - Each fixture's `args` predicate and trimmed `response` are right.
   - The PII scrub is best-effort — review names/dates/places in the scenario.

## Decision rules

| Situation | Action |
|---|---|
| The cause is a tool bug or a stale rubric/fixture (Step 1) | Stop. Say so and route it (MCP PR, or `rubric-critic`) — do not mine a unit test. |
| Can't confidently name one sub-skill | Ask the user; on the recorded path, run `/interpret-e2e-result` first. |
| Cause is `/research` routing, FS drift, or jitter | Not a body test. Split `/research`: "picked the wrong sub-skill" → `make optimize-skill` (description optimizer); "skipped a GPS step" → a `research`-body (orchestrator) `SKILL.md` edit (the optimizer can't fix it). Discard drift/jitter. |
| Run inside a feedback-case dir (a `.feedback-repo-root` is present) | You're in the wrong skill — use `/draft-unit-test`. |
| The `results/` folder / recorded payloads are absent | Emit fixture placeholders and flag them in the Step 8 printout for the user to fill in. |
| A test or scenario for `<slug>` already exists | Don't overwrite — append `-2`/`-3` and let the user consolidate. |
| Skill has no `eval/tests/unit/<skill>/` dir yet | Create it; flag in the Step 8 printout that the rubric needs authoring. |
| You can't cleanly separate the sub-skill's input from its output | Carve your best guess, and flag the scenario prominently in the Step 8 printout — this is the step most likely to need the user's hand. |
