---
name: draft-unit-test
description: Generate a first-cut unit test, scenario, and MCP fixtures
  from a feedback case after the user has fixed the underlying bug.
  Use after `/compare-state --against=desired` reports "matches",
  when the user is ready to promote the fix into a regression test.
  Invoke as `/draft-unit-test` (skill is inferred from the recent
  transcript's tool calls) or `/draft-unit-test --skill <name>` to
  pick explicitly. Writes test JSON, scenario directory, and MCP
  fixtures into the main repo (via the `.feedback-repo-root` marker
  in the case directory). All outputs are first cuts the user refines
  via the CRUD UI before committing.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# draft-unit-test

Scaffolds a regression unit test from a feedback case. Output is a
first cut for the user to refine via the CRUD UI at `eval/app/`.

This skill is part of the feedback-case workflow documented in
[`docs/specs/feedback-case-spec.md`](../../../docs/specs/feedback-case-spec.md)
§4.2. You are running inside a case directory wired by
`scripts/setup-feedback-case.sh`. The case directory contains a
`.feedback-repo-root` file pointing at the main repo where your
outputs go.

## Invocation

```
/draft-unit-test                       # infer skill from transcript
/draft-unit-test --skill <skill-name>  # pick explicitly
```

## Steps

### 1. Resolve the repo root

Read `.feedback-repo-root` from the current working directory. Its
contents are the absolute path of the main `cowork-genealogy` repo
checkout. All outputs in this skill land under that path, never in
the case directory.

If `.feedback-repo-root` is missing, abort with:

> Not a feedback-case directory, or this case was not set up via
> `scripts/setup-feedback-case.sh`. Run that helper first; see
> `docs/specs/feedback-case-spec.md` §3.1.

Let `$REPO` denote the path you just read. Everywhere below,
`$REPO/eval/...` means the absolute path under the resolved repo
root.

### 2. Identify the failing skill

If `--skill <name>` was passed, use that. Otherwise, inspect the
recent Claude Code transcript turns and pick the plugin skill whose
`allowed-tools` overlap most with the tools the agent actually
called. Plugin skills live at `$REPO/packages/engine/plugin/skills/<name>/SKILL.md`;
read the `allowed-tools` frontmatter to compare.

If you cannot confidently identify the skill, abort and ask the user
to pass `--skill` explicitly.

### 3. Read the rubric and reference test

Read `$REPO/eval/tests/unit/<skill>/rubric.md` to see the grading
dimensions you're targeting (the rubric itself is **not** something
you write — it's per-skill, set by senior genealogists). Read one
existing test file under `$REPO/eval/tests/unit/<skill>/*.json` to
match its shape — same skill family, same conventions.

### 4. Read case context

Read `_feedback/feedback.json` for `user_prompt`,
`agent_should_have`, and (if present) `agent_did`. Then read the
current state of `research.json` and `tree.gedcomx.json` to
identify which entities (persons, places, sources, plans) the
failure touched.

If `_feedback/session-log.jsonl` exists, scan it for the tools the
agent called during the failing session and the args it passed —
you need this for step 7 (fixture emission).

### 5. Extract a minimal scenario

Generate three files under
`$REPO/eval/fixtures/scenarios/<slug>/`, where `<slug>` is the
basename of the case directory (the same string used in step 6's
test id):

- `README.md` — one paragraph describing the scenario and which
  bug it captures. Reference the case slug and `submitted_at` for
  traceability, but keep PII out of the description.
- `research.json` — minimal project state limited to the entities
  the failure touched. **Best-effort PII scrub:** names replaced
  with placeholders (`Person A`, `Person B`), specific dates
  rounded to the decade, place names generalized to county or
  country. The scrub is heuristic and unreliable for genealogy
  data specifically — historical ancestor names look
  indistinguishable from living-person names, so **review the scrub by
  hand before committing** and record that reminder in the scenario
  README. Keep `research.json` **schema-clean** — do NOT add a top-level
  `_draft` block (or any extra top-level key): the harness validates the
  scenario before running, and a stray key makes the test abort as
  *not-runnable* with nothing to grade.
- `tree.gedcomx.json` — minimal GedcomX with the same scrub rules.
  Include only persons/relationships/sources the failure actually
  used; drop the rest.

### 6. Emit the test JSON

Write `$REPO/eval/tests/unit/<skill>/<slug>.json`. Use the shape
already established in the existing tests for that skill:

```json
{
  "test": {
    "id": "ut_<skill_with_underscores>_<NNN>",
    "skill": "<skill>",
    "name": "<one-line summary derived from agent_should_have>",
    "type": "positive",
    "description": "<2-3 sentence draft summarizing the failure mode and what the skill should do instead>",
    "tags": ["from-feedback", "<slug>", "re-invoke-safe"]
  },
  "input": {
    "user_message": "<user_prompt verbatim from feedback.json>",
    "scenario": "<slug>"
  },
  "judge_context": [
    "<one bullet per concrete behavior the skill should exhibit, derived from agent_should_have>",
    "..."
  ]
}
```

**Keep the test JSON schema-clean** — do NOT add a top-level `_draft` block.
Nothing in the harness or CRUD UI reads it, and any unknown top-level key
makes the harness skip the test as schema-invalid. It's a *draft* because you
tell the user so in step 10's printout (with the "tighten judge_context /
confirm the scenario / review fixture predicates / review PII" reminders),
not because of a marker in the file.

`<NNN>` is the next unused integer for that skill. Scan existing
test ids under `$REPO/eval/tests/unit/<skill>/*.json`, find the
highest `ut_<skill>_NNN` value, and increment. Zero-pad to three
digits.

`judge_context` is **background** for the LLM judge, not a scored
dimension — the rubric (already authored) is what's scored. Each
bullet should be a concrete observation the judge can ground its
rationale in.

### 7. Emit MCP fixtures

For every distinct (tool, args-pattern) the failing agent called
(per `session-log.jsonl` or your read of the recent transcript),
write or reuse a fixture file at
`$REPO/eval/fixtures/mcp/<fixture-name>.json`:

```json
{
  "tool": "<tool name from session-log>",
  "description": "<short — include the case slug for traceability>",
  "args": { "<arg>": "<predicate, e.g. ~Schuylkill>" },
  "response": { ... }
}
```

**Naming:** `<fixture-name>` is `<tool-short>-<descriptive-suffix>`
matching the existing convention in
`$REPO/eval/fixtures/mcp/` (look at examples like
`record-search-flynn-no-results.json`,
`wiki-search-irish-immigration.json`). `<tool-short>` drops any
`mcp__genealogy__` prefix and converts underscores to hyphens.
`<descriptive-suffix>` comes from the most distinctive args value
(a place name, person name, or query keyword), lowercased and
hyphenated.

**Deduplication:** Before writing each fixture, list existing
files at `$REPO/eval/fixtures/mcp/` (use Glob). Use your judgment
to decide whether an existing fixture's args predicate covers the
call already — if so, **reuse** it (reference the existing
filename in the test's `judge_context` rather than writing a
duplicate). If unsure or two fixtures are similar but might
differ, write a new file with a `-2`/`-3` suffix and let the user
consolidate during the CRUD-UI review. Don't over-think matching
rules; the user sees and adjusts.

**Args & response shapes:** Pull from `session-log.jsonl` where
present. Otherwise emit placeholders the user will fill in.

**Skip `validate_research_schema`** — it's the one live tool in
the harness (reads workspace state directly), so it needs no
fixture. Every other tool needs one.

### 8. Do NOT modify rubric.md

The per-skill rubric at
`$REPO/eval/tests/unit/<skill>/rubric.md` is the grading contract
for all tests of that skill; it's authored by hand by senior
genealogists. This skill never writes to it. If the new test
requires a new rubric dimension, flag it in step 10's printout
and let a human add it.

### 9. Re-invoke assertion (tag only)

The test you wrote in step 6 already carries the `re-invoke-safe`
tag. That's it — do **not** generate a Python validator file.
The re-invocation contract is enforced by:

- the `## Re-invocation behavior` section in each
  `packages/engine/plugin/skills/<skill>/SKILL.md` (per spec §5), and
- the lint pytest that confirms every SKILL.md carries that
  section (per spec §9 step 7).

Generating Python validator code from SKILL.md prose is where
this skill would most often be wrong; the manual iteration check
in §3.3 step 11 covers the same ground at much lower risk.

### 10. Print output paths and the run command

As the **last thing** the skill does, print to the Claude Code
session:

- The absolute path of every file written. The user is running
  from the case directory and won't see new files there — they're
  in `$REPO`. Without this, "did the skill actually run?" is a
  real question.
- The exact command for §3.4 step 14, with the assigned `ut_…` id
  substituted in:
  ```
  cd $REPO/eval/harness
  uv run python run_tests.py --test ut_<skill>_<NNN>
  ```
  (The test + scenario are schema-clean, so this runs as-is — no `_draft`
  markers to strip first.)
- **This is a first cut — tell the user to verify before committing** (these
  reminders live here, not as a `_draft` block in the file): tighten
  `judge_context` to specific assertions; confirm the scenario captures the
  failure mode; review each fixture's args predicate; and **review the PII
  scrub** in the scenario (the heuristic is unreliable for genealogy names).

Make the paths + command copy-paste-friendly.

## Decision rules

| Situation | Action |
|---|---|
| `.feedback-repo-root` missing | Abort. The user is not in a properly-set-up case directory. |
| Can't identify the failing skill | Ask the user to pass `--skill <name>` explicitly. |
| Existing test for this slug already present | Don't overwrite. Append `-2`/`-3` to the filename and let the user consolidate. |
| Scenario directory `<slug>/` exists | Same — append `-2`/`-3`. |
| Skill has no `eval/tests/unit/<skill>/` directory | Create the directory, but flag in step 10's printout that this is the first test for this skill and the rubric needs authoring. |
| Skill is missing `rubric.md` entirely | Continue — the test will be graded on base dimensions only. Note it in step 10's printout. |
| MCP fixture would be a duplicate | Reuse the existing fixture; do not write a new file. Reference the existing filename in the test's `judge_context` for clarity. |
| `session-log.jsonl` is absent from the case | Use the current Claude Code session's transcript as your tool-call source instead. If neither is available, emit fixture placeholders and flag them in step 10's printout. |
