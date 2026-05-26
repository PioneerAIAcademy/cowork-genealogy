# Eval Framework

Systematic evaluation of Cowork Genealogy skills. Tests live as version-controlled JSON; the harness runs them against the Claude Agent SDK; an LLM judge grades each run; humans verify the grades through the CRUD UI. See [`docs/gps/skill-mcp-testing-plan.md`](../docs/gps/skill-mcp-testing-plan.md) for the strategic plan, [`docs/specs/unit-test-spec.md`](../docs/specs/unit-test-spec.md) for the test format, and [`docs/plan/eval-runlog-versioning.md`](../docs/plan/eval-runlog-versioning.md) for the run-log versioning and release workflow.

## Directory layout

```
eval/
  harness/         Python test harness (Claude Agent SDK)
    harness/      Implementation modules (snapshot, versioning, runlog, …)
    scripts/      GH-action helpers (check_runlogs.py)
    validators/   Per-skill deterministic validators
    tests/        Harness's own unit + e2e tests
  fixtures/
    scenarios/    Shared project-state fixtures (research.json + tree.gedcomx.json)
    mcp/          Mocked MCP tool response fixtures
  tests/
    unit/<skill>/   Test definitions per skill + rubric.md
    e2e/            Future: GPS proof-statement tests
  runlogs/         Harness output; see "Run log naming" below
  app/             Next.js CRUD UI for test authoring, annotation, comparison
  Setup.bat        Windows: one-time setup
  Start.bat        Windows: launch the CRUD UI
  RunTests.bat     Windows: run the harness
```

`eval/CLAUDE.md` is the agent-facing guide for working inside this directory (conventions, file types, what's where). Read it when modifying eval files.

## Prerequisites

- **Python 3.11+** with [uv](https://github.com/astral-sh/uv) (`pip install uv` or `brew install uv`).
- **Node.js 20+** with npm.
- **Anthropic API key** — required. The skill runner and the LLM judge both use it. `Setup.bat` will prompt for the key and save it to `eval/.env`; you can also put it there directly:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Or set it in your shell. Claude Code subscription auth (`~/.claude/`) is supported as a fallback only when no API key is configured. See `eval/harness/harness/auth.py` for resolution rules.

## Running manually (macOS / Linux)

The Windows batch scripts wrap a few `uv` / `npm` commands. On macOS or Linux, run them directly:

### Test harness

```bash
cd eval/harness

# One-time setup
uv sync

# Run every test for one skill — full-skill runs produce versioned, releasable run logs.
uv run python run_tests.py --skill search-wikipedia

# Run a single test by ID — produces a scratch run log (gitignored).
uv run python run_tests.py --test ut_search_wikipedia_001

# Run by tag (AND semantics; repeatable) — scratch.
uv run python run_tests.py --tag census --tag 1850

# Run the whole suite (slow — ~30s/test serial) — scratch per skill.
uv run python run_tests.py --all
```

Tests run serially in v1 — a 200-test suite is ~100 minutes. Prefer `--skill <name>` for routine work.

### CRUD UI

```bash
cd eval/app

# One-time setup (installs deps + generates Zod schemas)
npm install

# Launch the dev server
npm run dev
```

Then open <http://localhost:3000>. The CRUD UI reads + writes the same `eval/` tree the harness writes to — keep them on the same filesystem checkout.

### Useful harness flags

- `--runlogs-root <dir>` — write run logs somewhere other than the default. Useful for one-off experiments that shouldn't pollute the committed tree.
- `--tests-dir <dir>` — point the harness at a non-default test corpus.
- `--max-cost-usd <n>` — suite-wide spend cap. Default 50.
- `--max-wall-clock-seconds <n>` — suite-wide wall-clock cap. Default 14400 (4 hours).

### Harness exit codes

- `0` — every test passed or was an expected xfail.
- `1` — harness crash, or any test failed or unexpectedly passed.
- `2` — any test aborted with `not_runnable` (corpus issue — missing scenario, fixture, or rubric).
- `3` — any test aborted for an execution reason (max turns, timeout, etc.).

## Running tests

The harness itself has a unit-test suite:

```bash
cd eval/harness
uv run pytest tests/unit/ -q
```

E2E tests at `eval/harness/tests/e2e/` hit the real Anthropic API and are deselected by default. Run them with `-m e2e`.

The CRUD UI has Vitest unit + integration tests:

```bash
cd eval/app
npm test                # one-shot
npm run test:watch      # watch mode
npm run typecheck       # tsc --noEmit
```

## Run log naming

Run logs live at `eval/runlogs/unit/<skill>/<filename>`. There is no model dir — the model the run executed against is stored in the run-log JSON's `model` field and in `plugin/skills/<skill>/SKILL.md` frontmatter.

Filenames classify into three kinds:

| Pattern | Kind | Notes |
|---|---|---|
| `v{N}.json` + `v{N}.ann.json` | **released** | Senior-blessed; the canonical version. Immutable. |
| `v{N}_{YYYY-MM-DD_HH-MM-SS}.json` + matching `.ann.json` | **candidate** | A full-skill iteration of v{N} that hasn't been released yet. Multiple per version are normal during iteration. |
| `scratch_{YYYY-MM-DD_HH-MM-SS}.json` | **scratch** | Partial / single-test / multi-skill runs. Gitignored — never committed. Local-only debugging. |

A run is **releasable** iff invoked as `--skill <name>` with no `--tag` filter — that's the only invocation that exercises the complete test suite for one skill. Everything else writes a `scratch_` file.

The release flow is: junior iterates with `--skill X` → harness writes `v{N}_<ts>.json` candidates → junior reviews scores in the CRUD UI → senior pulls the PR branch and clicks **Release** on the active candidate → file renames to `v{N}.json`.

## Reading a run log

Run logs are JSON envelopes validated against [`docs/specs/schemas/run-log.schema.json`](../docs/specs/schemas/run-log.schema.json). One envelope per harness invocation, per skill, containing every test that ran. Key fields:

- `skill`, `version`, `released`, `releasable`, `invocation`, `timestamp`, `model`, `harness_version`.
- `judge_prompt_hash` — SHA-256 of the normalized `eval/harness/judge/prompt.md` at run time (NOT in the snapshot — the judge prompt is project-global, so it's tracked separately so judge edits don't clobber every skill on activate).
- `snapshot` — `{repo-relative-path: normalized-content}` of every skill-side file used to produce this run (`plugin/skills/<skill>/**`, `eval/tests/unit/<skill>/**`, referenced scenarios + fixtures). The active-state check compares this map to the working tree.
- `tests[]` — per-test entries:
  - `outcome` (`pass | partial | fail | aborted | xfail | xpass`)
  - `flaky`, `outcome_summary.aggregated_dimensions[]` (1–3 per-dimension scores)
  - `runs[]` — per-execution detail: `output.text_response`, `tool_calls`, `validators`, `judge.dimensions[]` with rationales
- `totals` — token + cost aggregates summed across tests.

The CRUD UI's run-log detail page (`/results/<skill>/<filename-without-ext>`) is the primary reading surface. Raw JSON inspection is the fallback for harness debugging.

## CRUD UI day-to-day

- **`/results`** — every committed run log grouped by skill, with version badges and annotation status.
- **`/results/<skill>/<filename>`** — integrated test-centric view: per-test trace (input, scenario card, tool calls + fixtures, output) and grade block with per-dimension correction + comment + 📋 "copy as PR comment" button. Activate / Release / Delete actions live in the header. The "active" indicator marks the run log whose snapshot matches the working tree.
- **`/results/compare`** — arbitrary pair picker (default: latest released vs latest candidate). Headline weighted-mean delta + per-side histograms; per-test rows with edited-test exclusion; "what changed" panel diffing the two snapshots.
- **`/results/trend?skill=<skill>`** — per-skill plot of corrected weighted-mean over released versions, with test count + "tests changed since previous version" markers.
- **`/tests`, `/scenarios`, `/fixtures`** — authoring surfaces for the underlying corpus.

`.ann.json` files are **sparse** — entries only for dimensions the annotator has explicitly reviewed. The per-test "Agree with all" button populates entries with `corrected_score == llm_score` and no comment, marking them reviewed. A senior reviewing a PR uses the 📋 button on dimensions they disagree with to copy a markdown block straight to a PR comment — no separate senior UI; PR comments are the disagreement channel.

## Walkthroughs

- **[`eval/JUNIOR-WALKTHROUGH.md`](JUNIOR-WALKTHROUGH.md)** — your first PR as a junior genealogist: edit a skill, run the harness, review scores, push.
- **[`eval/SENIOR-WALKTHROUGH.md`](SENIOR-WALKTHROUGH.md)** — reviewing a PR + releasing: pull, compare, dispute via PR comments, click Release.

## Workflow

See [`docs/plan/eval-runlog-versioning.md`](../docs/plan/eval-runlog-versioning.md) for the canonical release/active/candidate workflow and [`docs/plan/per-pr-review-workflow.md`](../docs/plan/per-pr-review-workflow.md) for the per-PR cadence. Short version:

1. Junior edits a skill / tests / scenarios / fixtures.
2. Junior runs `uv run python run_tests.py --skill <skill>` → harness writes a `v{N}_<ts>.json` candidate.
3. Junior opens the CRUD UI, reviews every dimension on the latest candidate (sparse `.ann.json` becomes complete).
4. Junior commits the candidate + annotation, pushes the PR.
5. GH Action enforces: ≤1 added released file, latest full-skill run log is active on skill-side files (snapshot matches working tree), and its `.ann.json` is complete.
6. Senior reviews via GitHub diff + the CRUD UI compare page. Disagreements go to PR comments via the 📋 button.
7. Senior clicks **Release** on the active candidate → `v{N}_<ts>.json` → `v{N}.json` rename. Commits, pushes, approves.
8. Project owner merges.

## Windows users

`Setup.bat` performs the one-time setup. Then `Start.bat` launches the CRUD UI and `RunTests.bat` runs the harness against the current corpus.

## E2e tests

Separate from the unit-test framework documented above. E2e tests
exercise the full GPS research flow autonomously against live
FamilySearch APIs via the `/research --autonomous` skill. They're a
stakeholder-facing benchmark, not a regression suite — much more
expensive per run than unit tests (20–60 min, $3–10 each), so they
run on demand.

- **How-to:** [`../docs/e2e-testing-guide.md`](../docs/e2e-testing-guide.md) — creating fixtures, running tests, reading results, investigating failures.
- **Spec:** [`../docs/specs/e2e-test-spec.md`](../docs/specs/e2e-test-spec.md) — fixture format, judge contract, result schema.
- **Code:** `harness/e2e/` — orchestrator, judge, CLI.
- **Fixtures:** `tests/e2e/<test-id>/` (added incrementally).
- **Runlogs:** `runlogs/e2e/<test-id>/run-<timestamp>.*` (committed).

## Related specs

- `docs/plan/eval-runlog-versioning.md` — Run-log versioning + active/release workflow (canonical).
- `docs/specs/unit-test-spec.md` — Unit-test JSON format + harness behavior.
- `docs/specs/e2e-test-spec.md` — E2e test format + judge contract.
- `docs/specs/eval-crud-ui-spec.md` — CRUD UI design.
- `docs/specs/research-schema-spec.md` — `research.json` schema.
- `docs/specs/simplified-gedcomx-spec.md` — `tree.gedcomx.json` schema.
- `docs/specs/schemas/` — Machine-readable JSON schemas referenced above.
- `docs/eval-rollout.md` — Active rollout plan and decision log.
