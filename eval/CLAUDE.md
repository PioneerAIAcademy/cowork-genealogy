# Eval Framework

Systematic evaluation of GeneFun skills through automated testing with human verification. This file is the agent-facing conventions doc for working inside `eval/`. For the human-facing quick-start, see `eval/README.md`. For the workflow and design rationale, see `docs/plan/per-pr-review-workflow.md`.

## Directory Layout

```
eval/
  CLAUDE.md              This file (agent conventions)
  README.md              Human-facing quick-start
  Setup.bat              One-time Windows setup (uv, npm, API key)
  Start.bat              Launch the Next.js test-creation/annotation app
  RunTests.bat           Execute the Python test harness
  app/                   Next.js CRUD app (test authoring + annotation + comparison)
  harness/               Python test runner (Claude Agent SDK)
    harness/             Implementation modules
    validators/          Per-skill deterministic validators
    tests/               The harness's own unit + e2e tests
    run_tests.py         CLI entry point
  fixtures/
    scenarios/           Shared project state fixtures (research.json + tree.gedcomx.json + README.md)
    mcp/                 Mocked MCP tool response fixtures
  tests/                 Test definitions (version-controlled source of truth)
    e2e/                 GPS proof statement tests (each in its own directory)
    unit/
      <skill-name>/      One directory per skill (matches plugin/skills/)
        rubric.md        Skill-specific grading dimensions
        *.json           Genealogist-written test files
  runlogs/               Generated test output + human annotations
    unit/
      <skill-name>/
        <model-version>/ Run logs grouped by model
    optimizer/           Optimizer-pass run logs (excluded from cross-PR comparison)
    e2e/                 GPS proof statement run logs (future)
```

## What Belongs Where

- **`tests/`** — Test case definitions. Source of truth. Always version-controlled. Never generated.
- **`runlogs/unit/`** — Generated output from harness runs + the team's `.ann` annotation file. Only the final run log per PR is committed (the GitHub Action enforces "at most one run log per skill subdirectory per PR" — see `.github/workflows/check-runlogs.yml`).
- **`runlogs/optimizer/`** — Description-optimizer and body-optimizer run logs. Excluded from cross-PR comparison and from the GitHub Action's runlog-count check. Not annotated.
- **`app/`** — The Next.js CRUD app for test authoring, annotation, and cross-PR comparison. Spec: `docs/specs/eval-crud-ui-spec.md`.
- **`harness/`** — The Python test runner that calls the Claude Agent SDK to execute tests and write run log files.
- **`harness/validators/`** — Developer-written Python validators (one `test_*.py` file per skill). Run automatically by the harness after each test execution. Results visible in the CRUD UI.
- **`fixtures/scenarios/`** — Shared project state fixtures. Each scenario is a directory with `research.json`, `tree.gedcomx.json`, and `README.md`. Tests reference scenarios by directory name.
- **`fixtures/mcp/`** — Mocked MCP tool response fixtures. Each fixture is a single JSON file with `tool`, `description`, and `response` fields. Tests reference fixtures by filename.

## Three Testing Layers

This eval framework is one of three complementary testing layers:

1. **Vitest** (`mcp-server/tests/`) — Tests whether MCP tool code works correctly. Developers maintain these.
2. **Skill evals** (this framework) — Tests whether Claude performs genealogy tasks well when using skills, including tool usage. Genealogists create, run, and grade these.
3. **Prompt optimizers** (automated) — Two optimizers that consume eval results to improve prompts, both running unattended:
   - **Description optimizer** — Hill-climbs the `description` field on skill and MCP tool definitions so Claude triggers them correctly (should-fire / should-not-fire test sets).
   - **Grading prompt optimizer** — Improves LLM judge rubrics and prompts so automated grading aligns with human corrections (targets dimensions where the LLM judge frequently disagrees with human-corrected scores in the monthly review).

Skill evals include tool-usage rubric dimensions (did Claude call the right tool? good arguments? used the response correctly?) so there is no separate MCP tool eval suite for genealogists to maintain.

## Naming Conventions

### Test files

Test definitions live in `tests/unit/<skill-name>/` and `tests/e2e/`. Format defined in `docs/specs/unit-test-spec.md` and `docs/specs/e2e-test-format-spec.md`.

```
tests/unit/locality-guide/alabama-1850s-collections.json
tests/e2e/gps-proof-adopted-child.json
```

### Run logs

The test harness writes one file per test run into the corresponding `runlogs/` directory. Organized by model version and named by UTC timestamp `YYYY-MM-DDTHH-MM-SSZ`:

```
runlogs/unit/locality-guide/claude-sonnet-4-6/
  2026-05-15T10-30-15Z.json
```

Same-second collisions raise `RunlogCollisionError` rather than overwriting. Format details in `docs/specs/schemas/run-log.schema.json`; key fields include `test_content_hash` (used by the comparison view to auto-exclude edited tests).

### Annotations

The team submitting a PR writes one `.ann.json` file per skill touched, alongside the run log it grades. Filename mirrors the run-log timestamp:

```
runlogs/unit/locality-guide/claude-sonnet-4-6/
  2026-05-15T10-30-15Z.json                    # raw run log
  2026-05-15T10-30-15Z.ann.json                # team's corrected grades
```

Schema: `docs/specs/schemas/ann.schema.json`. Every dimension of every test in the run log gets an entry, with `llm_score` and `corrected_score` (both numeric 1–3) side-by-side. Agreement is computed (`corrected_score == llm_score`), not stored as a flag. Senior feedback on the annotation flows through GitHub PR comments — there are no `.adj` adjudication files.

### How to tell what needs work

- A run log with **no `.ann.json` sibling** → unannotated; the team needs to annotate before the PR is reviewable.
- A run log with a `.ann.json` sibling → annotated; senior PR review pending.

### File content conventions

- **Run log JSON** — schema at `docs/specs/schemas/run-log.schema.json`. Contains test metadata, model version, timestamp, raw LLM output, deterministic check results, LLM judge scores (integer 1–3 per dimension).
- **Annotation JSON** — schema at `docs/specs/schemas/ann.schema.json`. Contains `run_log` filename reference, `annotator` (team identifier), and `corrections[]` with per-dimension `llm_score`/`corrected_score`/`comment` (both scores integer 1–3).

Filenames are for human scanning (`ls`, GitHub file browser). Structured metadata lives inside the JSON.

## Grading Scale

Per-dimension scores at every layer (judge tool_use, run log, `.ann` file, CRUD UI) use the same integer scale: **`3` = pass, `2` = partial, `1` = fail.** The semantic labels (pass/partial/fail) live in the judge prompt's instruction text and in each dimension's `**pass:** / **partial:** / **fail:**` bullets in `rubric.md`; the data field itself is just the integer. The monthly judge-prompt review (per the per-PR workflow plan §2.6) reads `.ann` files and computes `llm_score - corrected_score` deltas grouped by `(dimension_source, dimension_name)` to identify systematic drift in the LLM judge.

The run-log-level `outcome` field (`pass | partial | fail | aborted | xfail | xpass`) is a different concept — it's the aggregated run outcome for dashboard reporting, not a per-dimension grade. It remains a string enum.

## Model Pinning

The test harness pins a specific model version (e.g., `claude-sonnet-4-6-20250514`) to minimize variance between local and canonical runs. Bumping the pin invalidates apples-to-apples cross-PR comparison; the run log records the model used so older comparisons remain interpretable.

## What This Framework Does NOT Cover

- MCP tool code correctness (use Vitest in `mcp-server/tests/`)
- Description optimization (automated, see `docs/gps/skill-mcp-testing-plan.md` Appendix C)
- Grading prompt optimization (automated, see same)
- Network/integration testing of MCP tools (use `mcp-server/dev/try-*.ts`)

## Eval vs production parity

The harness is deliberately *not* a perfect reproduction of how skills run in Cowork. A passing eval suite does not guarantee identical production behavior. The known divergences:

- **`setting_sources=["project"]`.** Production loads `["user","project"]`. Eval omits `"user"` so a developer's `~/.claude/skills/` doesn't contaminate routing tests — outcomes need to be reproducible across machines and CI. Production's `~/.claude/` is a fresh VM each run, so this divergence is harmless in practice.
- **No `temperature=0`.** The installed `claude-agent-sdk` doesn't expose a `temperature` field; the underlying CLI uses its default decoding. Variance leaks into single-run outcomes — fine for PR gates, matters for description-optimizer / golden-set work (bump `runs_per_test`).
- **Mock MCP server.** Production hits real APIs; eval hits in-process mock responses from `eval/fixtures/mcp/`. Argument-quality grading is approximate — the mock can advertise an `input_schema` when fixture authors provide one (spec §3.2), but the schema and the live API may drift.
- **Sandboxed workspace.** Production runs in Cowork's VM with its egress allowlist; eval runs in a tempdir on the host. Skills that rely on environment differences may behave differently.
- **Serial execution.** Eval runs tests one at a time (`asyncio.run` per test) for stability. Production Cowork may run skills under different cadences. Parallel eval execution is on the v2 plan; expect ~30s/test today, so a 200-test suite is ~100 min single-threaded — gate CI to specific skills/tags rather than `--all`.

End-to-end fidelity testing happens via the layered testing playbooks in `docs/testing-guides/*.md`, not in this eval framework.

## Workflow

See `docs/plan/per-pr-review-workflow.md` for the per-PR skill-iteration workflow: how juniors author tests, run the harness, correct LLM grades, and submit PRs; how seniors review.
