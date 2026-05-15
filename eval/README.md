# Eval Framework

Systematic evaluation of GeneFun skills. Tests live as version-controlled JSON; the harness runs them against the Claude Agent SDK; an LLM judge grades each run; humans verify the grades. See [`docs/gps/skill-mcp-testing-plan.md`](../docs/gps/skill-mcp-testing-plan.md) for the strategic plan and [`docs/specs/unit-test-spec.md`](../docs/specs/unit-test-spec.md) for the test format.

## Directory layout

```
eval/
  harness/         Python test harness (Claude Agent SDK)
    harness/      Implementation modules
    validators/   Per-skill deterministic validators
    tests/        Harness's own unit + e2e tests
  fixtures/
    scenarios/    Shared project-state fixtures (research.json + tree.gedcomx.json)
    mcp/          Mocked MCP tool response fixtures
  tests/
    unit/<skill>/   Test definitions per skill + rubric.md
    e2e/            Future: GPS proof-statement tests
  runlogs/         Harness output, organized by skill + model
  app/             Next.js CRUD UI for test authoring + annotation
  Setup.bat        Windows: one-time setup
  Start.bat        Windows: launch the CRUD UI
  RunTests.bat     Windows: run the harness
```

`eval/CLAUDE.md` is the agent-facing guide for working inside this directory (conventions, file types, what's where). Read it when modifying eval files.

## Prerequisites

- **Python 3.11+** with [uv](https://github.com/astral-sh/uv) (`pip install uv` or `brew install uv`).
- **Anthropic API key** — required for the LLM judge. The skill runner uses Claude Code subscription auth when `~/.claude/` is present, falling back to the API key when not. Put the key in `eval/.env`:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Or set it in your shell. See `eval/harness/harness/auth.py` for the resolution rules.

## Running the harness

From `eval/harness/`:

```bash
# One-time setup
uv sync

# Run a single test by ID
uv run python run_tests.py --test ut_wiki_lookup_001

# Run every test for one skill
uv run python run_tests.py --skill wiki-lookup

# Run by tag (AND semantics; repeatable)
uv run python run_tests.py --tag census --tag 1850

# Run the whole suite (slow — ~30s/test serial)
uv run python run_tests.py --all
```

Run logs land under `eval/runlogs/unit/<skill>/<model>/<timestamp>.json`. The harness prints a summary table at the end.

### Useful flags

- `--runlogs-root <dir>` — write run logs somewhere other than the default. Useful for one-off experiments that shouldn't pollute the committed tree.
- `--tests-dir <dir>` — point the harness at a non-default test corpus (e.g., for testing the harness itself).
- `--max-cost-usd <n>` — suite-wide spend cap. Default 50.
- `--max-wall-clock-seconds <n>` — suite-wide wall-clock cap. Default 14400 (4 hours).

### Exit codes

- `0` — every test passed or was an expected xfail.
- `1` — harness crash, or any test failed or unexpectedly passed.
- `2` — any test aborted with `not_runnable` (corpus issue — missing scenario, fixture, or rubric).
- `3` — any test aborted for an execution reason (max turns, timeout, etc.).

## Running the harness's own unit tests

The harness itself has a unit-test suite at `eval/harness/tests/unit/`:

```bash
cd eval/harness
uv run pytest tests/unit/ -q
```

E2E tests at `eval/harness/tests/e2e/` hit the real Anthropic API and are deselected by default. Run them with `-m e2e`.

## Reading a run log

Run logs are JSON files validated against [`docs/specs/schemas/run-log.schema.json`](../docs/specs/schemas/run-log.schema.json). Key fields:

- `outcome` — aggregated `pass | partial | fail | aborted | xfail | xpass`.
- `outcome_summary.aggregated_dimensions` — per-rubric-dimension scores (`pass`/`partial`/`fail`).
- `runs[].validators` — deterministic-check results.
- `runs[].judge.dimensions` — per-dimension LLM-judge grades + rationales.
- `runs[].output.text_response` — Claude's full response text.
- `test_content_hash` — SHA-256 of the resolved test (test JSON + scenario + fixtures), used by the cross-PR comparison view to auto-exclude edited tests.

Once the CRUD UI's Results section is built, juniors read run logs and write annotations through it; raw-JSON inspection is the fallback for dev work.

## Windows users (junior genealogists)

Double-click `Setup.bat` once. Then:

- `Start.bat` — opens the CRUD UI in your browser.
- `RunTests.bat` — runs the harness against the current test corpus.

The CRUD UI is the primary tool for authoring tests and annotating run logs. The batch scripts wrap the same `uv run` commands above so non-technical users don't have to use a terminal.

## Workflow

See [`docs/plan/per-pr-review-workflow.md`](../docs/plan/per-pr-review-workflow.md) for the per-PR skill-iteration workflow: how juniors author tests, run the harness, correct LLM grades, and submit PRs; how seniors review.

## Related specs

- `docs/specs/unit-test-spec.md` — Unit-test JSON format + harness behavior.
- `docs/specs/eval-crud-ui-spec.md` — CRUD UI design.
- `docs/specs/research-schema-spec.md` — `research.json` schema.
- `docs/specs/simplified-gedcomx-spec.md` — `tree.gedcomx.json` schema.
- `docs/specs/schemas/` — Machine-readable JSON schemas referenced above.
- `docs/eval-rollout.md` — Active rollout plan and decision log.
