# Eval Framework

Systematic evaluation of Cowork Genealogy skills through automated testing with human verification. This file is the agent-facing conventions doc for working inside `eval/`. For the human-facing quick-start, see `eval/README.md`. For the versioning + release workflow, see `docs/plan/eval-runlog-versioning.md`. For the per-PR cadence and team workflow, see `docs/plan/per-pr-review-workflow.md`.

## Directory Layout

```
eval/
  CLAUDE.md              This file (agent conventions)
  README.md              Human-facing quick-start
  Setup.bat              One-time Windows setup (uv, npm, API key)
  Start.bat              Launch the Next.js CRUD UI
  RunTests.bat           Execute the Python test harness
  app/                   Next.js CRUD UI (test authoring + annotation + comparison)
  harness/               Python test runner (Claude Agent SDK)
    harness/             Implementation modules (snapshot, versioning, runlog, …)
    scripts/             GH-action helpers (check_runlogs.py)
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
      <skill-name>/      All run logs for the skill live directly here (no model dir)
    optimizer/           Optimizer-pass run logs (excluded from cross-PR comparison)
    e2e/                 GPS proof statement run logs (future)
```

## What Belongs Where

- **`tests/`** — Test case definitions. Source of truth. Always version-controlled. Never generated.
- **`runlogs/unit/<skill>/`** — Generated multi-test envelopes from harness runs, plus their `.ann.json` annotation siblings. One envelope per harness invocation per skill (see "Run log naming" below). Scratch runs are gitignored.
- **`runlogs/optimizer/`** — Description-optimizer and body-optimizer run logs. Excluded from cross-PR comparison and from the GitHub Action checks. Not annotated.
- **`app/`** — The Next.js CRUD app for test authoring, annotation, comparison, trend, activate / release / delete. Spec: `docs/specs/eval-crud-ui-spec.md`. Latest workflow: `docs/plan/eval-runlog-versioning.md`.
- **`harness/`** — The Python test runner that calls the Claude Agent SDK to execute tests and write run log files.
- **`harness/harness/snapshot.py`** — `normalize(path, bytes) → str` + `build_snapshot()`. Cross-platform normalization contract shared with `eval/app/lib/snapshot.ts`; the two implementations must produce byte-identical output (shared test vectors in `tests/unit/test_snapshot.py` and `tests/unit/snapshot.test.ts`).
- **`harness/harness/versioning.py`** — Run-log filename classification + next-version resolution.
- **`harness/scripts/check_runlogs.py`** — Invoked by `.github/workflows/check-runlogs.yml`; enforces the three runlog discipline rules (see "GitHub Action rules" below).
- **`harness/validators/`** — Developer-written Python validators (one `test_*.py` file per skill). Run automatically by the harness after each test execution. Results visible in the CRUD UI.
- **`fixtures/scenarios/`** — Shared project state fixtures. Each scenario is a directory with `research.json`, `tree.gedcomx.json`, and `README.md`. Tests reference scenarios by directory name.
- **`fixtures/mcp/`** — Mocked MCP tool response fixtures. Each fixture is a single JSON file with `tool`, `description`, and `response` fields. Tests reference fixtures by filename.

## Three Testing Layers

This eval framework is one of three complementary testing layers:

1. **Vitest** (`mcp-server/tests/`) — Tests whether MCP tool code works correctly. Developers maintain these.
2. **Skill evals** (this framework) — Tests whether Claude performs genealogy tasks well when using skills, including tool usage. Genealogists create, run, and grade these.
3. **Prompt optimizers** (automated) — Description and grading-prompt optimizers consume eval results to improve prompts. Both run unattended. See `docs/gps/skill-mcp-testing-plan.md` Appendix C.

Skill evals include tool-usage rubric dimensions, so there is no separate MCP tool eval suite for genealogists to maintain.

## Run log naming

Run logs live at `eval/runlogs/unit/<skill>/<filename>`. There is **no model directory** — the model the run executed against is stored in the run-log JSON's `model` field and in `plugin/skills/<skill>/SKILL.md` frontmatter. Activating a run log restores the `model:` frontmatter alongside the rest of the snapshot.

Filenames classify into three kinds:

| Pattern | Kind | Notes |
|---|---|---|
| `v{N}.json` + `v{N}.ann.json` | **released** | Senior-blessed. The canonical version. |
| `v{N}_{YYYY-MM-DD_HH-MM-SS}.json` + matching `.ann.json` | **candidate** | A full-skill iteration of v{N} that hasn't been released yet. |
| `scratch_{YYYY-MM-DD_HH-MM-SS}.json` | **scratch** | Partial / `--test` / `--all` / `--tag` runs. Gitignored. |

A run is **releasable** iff invoked as `--skill <name>` with no `--tag`. Anything else writes a `scratch_` file.

The harness picks the next filename per `eval/harness/harness/versioning.py::next_filename_for`:
1. Scan the skill dir for the highest released `v{N}.json` (call it R) and the highest candidate `v{M}_<ts>.json` (call it U).
2. If a candidate above the latest release exists (`U > R`): next candidate is `v{U}_<ts>.json`.
3. Otherwise: next is `v{R+1}_<ts>.json` (new candidate line).
4. If neither released nor candidate exists: `v1_<ts>.json`.

Same-second collisions raise `RunlogCollisionError` rather than overwriting.

### Format details

- **Run-log envelope** — schema at `docs/specs/schemas/run-log.schema.json` (v2). One envelope per harness invocation per skill, containing `tests[]` (per-test entries), the `snapshot` of every skill-side file used, and metadata (`version`, `released`, `releasable`, `invocation`, `judge_prompt_hash`, …).
- **Annotation** — schema at `docs/specs/schemas/ann.schema.json`. **Sparse**: corrections entries exist only for dimensions the annotator has explicitly reviewed. Missing entries = not reviewed (NOT the same as "agreed"). The CRUD UI's "Agree with all" button creates entries with `corrected_score == llm_score`, marking them reviewed. Schema fields: `run_log` (filename), `annotator` (team identifier), `corrections[]` with per-dimension `llm_score` / `corrected_score` (integer 1–3) / optional `comment`.

The "active" run log for a skill is the newest releasable run log whose snapshot matches the working tree (compared via `normalize()`). The CRUD UI computes this lazily on the per-skill page (`detectActiveRunLog` in `lib/fs/runlogs.ts`).

## Grading Scale

Per-dimension scores use integers 1–3: **`3` = pass, `2` = partial, `1` = fail.** The semantic labels live in the judge prompt and in each dimension's `**pass:** / **partial:** / **fail:**` bullets in `rubric.md`; the data field is just the integer.

The run-log-level `outcome` (`pass | partial | fail | aborted | xfail | xpass`) is per-test, not per-dimension — aggregated across runs for dashboard reporting.

## Snapshot model

Every run log embeds a `snapshot: {repo-relative-path: normalized content}` block covering every skill-side file used:

- `plugin/skills/<skill>/**`
- `eval/tests/unit/<skill>/**` (rubric + test JSONs)
- referenced `eval/fixtures/scenarios/<name>/**`
- referenced `eval/fixtures/mcp/<name>.json`

`eval/harness/judge/prompt.md` is **not** in the snapshot — it's project-global and gets a separate `judge_prompt_hash` field. This keeps "activate this run log" a per-skill operation; activating skill A's v1 doesn't clobber skill B's judge calibration.

Normalization rules (shared with `eval/app/lib/snapshot.ts`):
- JSON files: parse + re-emit with sorted keys, indent=2, trailing newline. Test JSONs (`eval/tests/unit/*/*.json`) also strip `test.{name,description,tags}` cosmetic fields.
- Text files (`.md`, `.txt`, `.yaml`, `.yml`, …): CRLF → LF, ensure trailing newline.

## Releasable invocations

| Invocation | Releasable? | Filename |
|---|---|---|
| `run_tests.py --skill <name>` (no `--tag`) | yes | `v{N}_<ts>.json` (or `v{N}.json` after release) |
| `run_tests.py --skill <name> --tag <t>` | no | `scratch_<ts>.json` |
| `run_tests.py --test ut_xxx` | no | `scratch_<ts>.json` |
| `run_tests.py --all` | no | `scratch_<ts>.json` per skill |
| `run_tests.py --tag <t>` (no `--skill`) | no | `scratch_<ts>.json` per skill |

Scratch runs are gitignored via `.gitignore` patterns on `eval/runlogs/unit/*/scratch_*.json` and the matching `.ann.json`. They never enter version control, never participate in active-state, comparison, or trend, and can't be released.

## GitHub Action rules

`.github/workflows/check-runlogs.yml` invokes `eval/harness/scripts/check_runlogs.py` on every PR that touches `eval/runlogs/unit/**`, `eval/tests/unit/**`, `plugin/skills/**`, `eval/fixtures/**`, or `eval/harness/**`. Three blocking rules + one warn-only check (per `docs/plan/eval-runlog-versioning.md` §C6):

| Rule | Severity | What |
|---|---|---|
| 1 | block | At most one newly-added-or-renamed-into-place `v{N}.json` per skill (`--diff-filter=AR` catches the candidate → released rename). |
| 2 | block | The latest full-skill run log per touched skill is **active** — its snapshot matches the current PR-branch state. |
| 2b | warn | The same run log's `judge_prompt_hash` matches the current judge prompt. Mismatch is non-blocking (judge edits are a separate cadence). |
| 3 | block | The same run log's `.ann.json` has a correction entry for every dimension in every test. |

## Model Pinning

The skill harness pins a specific model per skill via `model:` in `plugin/skills/<skill>/SKILL.md` frontmatter (when set). Activating a run log restores that field along with the rest of the snapshot. The `model` field on the run log envelope records what the harness actually used.

`judge_model` is project-global, not per-run-versioned — bumping the judge model is a separate decision that invalidates historical comparisons.

## What This Framework Does NOT Cover

- MCP tool code correctness (use Vitest in `mcp-server/tests/`)
- Description optimization (automated, see `docs/gps/skill-mcp-testing-plan.md` Appendix C)
- Grading prompt optimization (automated, see same)
- Network/integration testing of MCP tools (use `mcp-server/dev/try-*.ts`)

## Eval vs production parity

The harness is deliberately *not* a perfect reproduction of how skills run in Cowork. A passing eval suite does not guarantee identical production behavior. The known divergences:

- **`setting_sources=["project"]`.** Production loads `["user","project"]`. Eval omits `"user"` so a developer's `~/.claude/skills/` doesn't contaminate routing tests.
- **No `temperature=0`.** The installed `claude-agent-sdk` doesn't expose a `temperature` field. Variance leaks into single-run outcomes — fine for PR gates, matters for description-optimizer / golden-set work (bump `runs_per_test`).
- **Mock MCP server.** Production hits real APIs; eval hits in-process mock responses from `eval/fixtures/mcp/`. Argument-quality grading is approximate.
- **Sandboxed workspace.** Production runs in Cowork's VM with its egress allowlist; eval runs in a tempdir on the host.
- **Serial execution.** Eval runs tests one at a time (~30s/test) for stability. A 200-test suite is ~100 minutes single-threaded — gate CI to specific skills/tags rather than `--all`.

End-to-end fidelity testing happens via the layered testing playbooks in `docs/testing-guides/*.md`, not in this eval framework.

## Workflow

See `docs/plan/eval-runlog-versioning.md` for the canonical release/active/candidate workflow and `docs/plan/per-pr-review-workflow.md` for the per-PR cadence (junior authors tests, runs harness, corrects LLM grades, submits PR; senior reviews and releases the candidate).
