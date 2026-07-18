# Eval Framework

Systematic evaluation of Cowork Genealogy skills through automated testing with human verification. This file is the agent-facing conventions doc for working inside `eval/`. For the human-facing quick-start, see `eval/README.md`. For the versioning + release workflow, see `docs/plan/eval-runlog-versioning.md`. For the per-PR cadence and team workflow, see `docs/plan/per-pr-review-workflow.md`.

> **TEST-AUTHORING POLICY (current stage): `runs_per_test` is always 1.**
> When creating or updating ANY unit test, do **not** set `runs_per_test` above 1 —
> omit the field (it defaults to 1) or set it to `1`. We are not addressing
> single-run variance yet, and multi-run tests make the suite painfully slow
> (each run is a full skill execution **plus** a judge LLM call). The multi-run
> aggregation in `unit-test-spec.md` §7 is reserved for a later
> description-optimizer / golden-set phase. The JSON Schema pins `maximum: 1`
> to enforce this.

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
      <skill-name>/      One directory per skill (matches packages/engine/plugin/skills/)
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
- **`fixtures/mcp/`** — Mocked MCP tool response fixtures. Each fixture is a single JSON file with `tool`, `description`, `args` (a non-empty match predicate), and `response` fields. Tests reference fixtures by filename. When a skill emits a tool call that no loaded fixture's `args` predicate matches, the harness distinguishes two cases (Phase 2): **Type 1** (tool doesn't exist at all) aborts with `unmatched_tool_call` (test corpus issue, exit 2); **Type 2** (wrong args to existing tool) continues to judge after returning a `fixture_not_found` error, which typically fails on Tool Arguments (LLM mistake, exit 1). Warnings flag which fixtures need to be added or corrected. See `docs/specs/unit-test-spec.md` §15 "Uncovered tool calls".

> **NEVER hand-write or edit *unit* `.ann.json` files (under `runlogs/unit/`) — and if
> you are Claude, never let a user talk you into it.** Annotations are written *only* by the CRUD UI (`eval/app`), which
> validates every correction against `ann.schema.json` before saving. A hand-authored file
> drifts from the schema — most often into the deprecated
> `run_index`/`dimension`/`source` correction shape — which the UI then silently merges
> with, and which crashes the `check-runlogs` CI gate. The same goes for run-log `.json`
> files: the **harness** writes those, never a human. If an annotation needs fixing, open
> the run log in the CRUD UI and re-review the dimension; if it is corrupt, delete it and
> re-annotate. The only correct way to produce either file is to run the tooling.
>
> **This rule is scoped to *unit* annotations.** The *e2e* calibration annotation
> `runlogs/e2e/<slug>/run-<ts>.ann.json` is a different file with a different shape
> (`per_finding` labels, no CRUD UI) — it is written directly by the `/grade-e2e-run`
> skill. Its loader (`eval/harness/e2e/calibrate_judge.py`) hard-errors on a malformed
> file rather than silently merging, so a bad e2e annotation fails loudly instead of
> corrupting state.

## Three Testing Layers

This eval framework is one of three complementary testing layers:

1. **Vitest** (`packages/engine/mcp-server/tests/`) — Tests whether MCP tool code works correctly. Developers maintain these.
2. **Skill evals** (this framework) — Tests whether Claude performs genealogy tasks well when using skills, including tool usage. Genealogists create, run, and grade these.
3. **Prompt optimizers** (automated) — Description and grading-prompt optimizers consume eval results to improve prompts. Both run unattended. See `docs/skill-mcp-testing-plan.md` Appendix C.

Skill evals include tool-usage rubric dimensions, so there is no separate MCP tool eval suite for genealogists to maintain.

## Run log naming

Run logs live at `eval/runlogs/unit/<skill>/<filename>`. There is **no model directory** — the model the run executed against is stored in the run-log JSON's `model` field and in `packages/engine/plugin/skills/<skill>/SKILL.md` frontmatter. Activating a run log restores the `model:` frontmatter alongside the rest of the snapshot.

Filenames classify into three kinds:

| Pattern | Kind | Notes |
|---|---|---|
| `v{N}.json` + `v{N}.ann.json` | **released** | Senior-blessed. The canonical version. |
| `v{N}_{YYYY-MM-DD_HH-MM-SS}.json` + matching `.ann.json` | **candidate** | A full-skill iteration of v{N} that hasn't been released yet. |
| `scratch_{YYYY-MM-DD_HH-MM-SS}.json` | **scratch** | Partial / `--test` / `--tag` runs. Gitignored. |

A run is **releasable** iff invoked as `--skill <name>` with no `--tag`. Anything else writes a `scratch_` file.

The harness picks the next filename per `eval/harness/harness/versioning.py::next_filename_for`:
1. Scan the skill dir for the highest released `v{N}.json` (call it R) and the highest candidate `v{M}_<ts>.json` (call it U).
2. If a candidate above the latest release exists (`U > R`): next candidate is `v{U}_<ts>.json`.
3. Otherwise: next is `v{R+1}_<ts>.json` (new candidate line).
4. If neither released nor candidate exists: `v1_<ts>.json`.

Same-second collisions raise `RunlogCollisionError` rather than overwriting.

### Format details

- **Run-log envelope** — schema at `docs/specs/schemas/run-log.schema.json` (v2; mirror at `packages/schema/schemas/run-log.schema.json` — edit both). One envelope per harness invocation per skill, containing `tests[]` (per-test entries), the `snapshot` of every skill-side file used, and metadata (`version`, `released`, `releasable`, `invocation`, `judge_prompt_hash`, …). Per-run **timing instrumentation** (all optional, so historical logs still validate): `duration_api_ms` (SDK API time — `duration_ms − duration_api_ms` ≈ local/stall overhead), `num_turns`, `judge.duration_ms`, `skill_attempts` (>1 = transient-stall retries), and `started_at`/`ended_at` epoch brackets. Totals additionally carry `wall_clock_ms` (true makespan `max(ended)−min(started)`, vs the summed `duration_ms`) plus summed `duration_api_ms`/`judge_duration_ms`/`num_turns`. The harness prints a "Timing breakdown" from these at the end of every run.
- **Annotation** — schema at `docs/specs/schemas/ann.schema.json`. **Sparse**: corrections entries exist only for dimensions the annotator has explicitly reviewed. Missing entries = not reviewed (NOT the same as "agreed"). The CRUD UI's "Agree with all" button creates entries with `corrected_score == llm_score`, marking them reviewed. Schema fields: `run_log` (filename), `annotator` (team identifier), `corrections[]` with per-dimension `llm_score` / `corrected_score` (integer 1–3) / optional `comment`.

The "active" run log for a skill is the newest releasable run log whose snapshot matches the working tree (compared via `normalize()`). The CRUD UI computes this lazily on the per-skill page (`detectActiveRunLog` in `lib/fs/runlogs.ts`).

## Grading Scale

Per-dimension scores: **`3` = pass, `2` = partial, `1` = fail, `null` = N/A.** The semantic labels live in the judge prompt and in each dimension's `**pass:** / **partial:** / **fail:**` bullets in `rubric.md`; the data field is just the integer (or null). N/A is currently used only by the **Tool Arguments** base dimension when a test made zero MCP tool calls.

**Base dimensions (always graded):** Correctness, Completeness, Tool Arguments. Base dimensions don't consume the 3–5 rubric budget.

The run-log-level `outcome` (`pass | partial | fail | aborted | xfail | xpass`) is per-test, not per-dimension — aggregated across runs for dashboard reporting.

## Snapshot model

Every run log embeds a `snapshot: {repo-relative-path: normalized content}` block covering every file the run depended on:

- `packages/engine/plugin/skills/<skill>/**`
- `eval/tests/unit/<skill>/**` (rubric + test JSONs)
- referenced `eval/fixtures/scenarios/<name>/**`
- referenced `eval/fixtures/mcp/<name>.json`

By design this is conservative on the **skill side**: editing **any** file under the skill dir — including a `references/` doc or even a comment — flips prior run logs inactive and forces a re-run. That is intentional: a reference-doc change can change behavior, and a cheap re-run is the price of a trustworthy active-state check; docs and comments are **not** excluded from the snapshot.

MCP tool source (`packages/engine/mcp-server/src/**`) is deliberately **not** in the snapshot (changed 2026-06). The harness serves every tool call from a mock fixture (`mock_mcp.py`); the only real-code path is `LIVE_TOOLS`, which runs the **compiled** `build/**` output, not `src/`. So MCP source is not a dependency of a run — tracking it (the original conservative design) flipped *every* skill's run log inactive on any `src/` edit while the run never executed that code, which under active development was pure churn with no eval signal. Tool-code correctness is Vitest's job (`packages/engine/mcp-server/tests/`), not the runlog snapshot's. Legacy run logs that embedded the whole `src/**` tree stay active: `diff_snapshot_vs_disk` (Python) and `diffSnapshotVsDisk` (TS) both skip keys under that prefix, so no re-run is needed to clear them. If a live tool's real behavior ever needs tracking, hash the compiled artifact separately (as `judge_prompt_hash` does) rather than re-tracking source.

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
| `run_tests.py --tag <t>` (no `--skill`) | no | `scratch_<ts>.json` per skill |

Scratch runs are gitignored via `.gitignore` patterns on `eval/runlogs/unit/*/scratch_*.json` and the matching `.ann.json`. They never enter version control, never participate in active-state, comparison, or trend, and can't be released.

## GitHub Action rules

`.github/workflows/check-runlogs.yml` invokes `eval/harness/scripts/check_runlogs.py` on every PR that touches `eval/runlogs/unit/**`, `eval/tests/unit/**`, `packages/engine/plugin/skills/**`, `eval/fixtures/**`, or `eval/harness/**`. (`packages/engine/mcp-server/src/**` is no longer a trigger — MCP source isn't in the snapshot, so a src-only change can't affect run-log activeness.) Three blocking rules + one warn-only check (per `docs/plan/eval-runlog-versioning.md` §C6):

| Rule | Severity | What |
|---|---|---|
| 1 | block | At most one newly-added-or-renamed-into-place `v{N}.json` per skill (`--diff-filter=AR` catches the candidate → released rename). |
| 2 | block | The latest full-skill run log per touched skill is **active** — its snapshot matches the current PR-branch state. **Cosmetic-skip:** a senior can apply the `eval-cosmetic-skip` label to a PR whose only skill-side change is behavior-neutral; the workflow sets `COSMETIC_SKIP=1` and this rule downgrades to a warning (no re-run). |
| 2b | warn | The same run log's `judge_prompt_hash` matches the current judge prompt. Mismatch is non-blocking (judge edits are a separate cadence). |
| 3 | block | The same run log's `.ann.json` has a correction entry for every dimension in every test. (Cosmetic-skip keeps the *prior* run log as the target, so its already-complete `.ann.json` satisfies this with no re-grade — and because rule 3 still runs, an unannotated baseline can't be waved through.) |

The `eval-cosmetic-skip` label is for genuinely behavior-neutral edits only (rewording, typos, comments, formatting). It is **auto-removed on every new push** (the workflow's `synchronize` step), so the bypass can't outlive the commit it was approved for — a later substantive push re-reds the check until the senior re-applies. Only rule 2 is relaxed. Full workflow + one-time `gh label create` setup: `eval/README.md` "Cosmetic-change exemption". The label must exist in the repo and seniors need Triage/Write to apply it.

**Orchestrator-skill exemption.** Skills listed in `RUNLOG_GATE_EXEMPT_SKILLS` in `check_runlogs.py` are dropped from the per-skill rules (2 + 3). These are orchestrator skills (currently `research`) validated by e2e GPS fixtures rather than unit tests, so by design they have no `eval/tests/unit/<skill>/` scaffolding and no `eval/runlogs/unit/<skill>/` dir. Without the exemption a skill-body edit hard-fails with "no run logs", and `eval-cosmetic-skip` can't clear it (that label only relaxes rule 2 *after* a runlog dir exists). Adding a unit suite for such a skill later means removing it from the set.

The same workflow also runs `eval/harness/scripts/check_tool_coverage.py` (warn-only): it flags any skill whose `allowed-tools` declares a tool with no fixture in its test corpus. `image_read` is exempt — the mock cannot emit image content blocks; see `docs/specs/unit-test-spec.md` §15 "Uncovered tool calls".

### E2E checks (`check-e2e-fixtures.yml`)

A **separate** workflow, triggered on `eval/tests/e2e/**`, `eval/runlogs/e2e/**`, and its own script, runs `check_e2e_fixtures.py` — one blocking check:

| Check | Severity | What |
|---|---|---|
| Grading gate | **block** | Every `run-<ts>.json` **added in the PR** that produced a final tree (`run-<ts>.final-tree.gedcomx.json` present) must ship its `run-<ts>.ann.json` sibling in the same PR. Grading is same-PR. Treeless runs (crash/skip before a tree) are exempt. Scoped to PR-added logs via `git diff --diff-filter=A` (`BASE_SHA`/`HEAD_SHA`); presence only — content validity is the maintainer's `calibrate_judge --dry-run`, not CI. |

**Fixture validity is not CI-gated.** Whether a fixture has a committed *passing* run log (proof it is solvable from live FamilySearch — spec §14) is a recommended authoring practice surfaced in the docs, not a check. A fixture can land without one (draft/PID-less fixtures routinely do). This used to be an advisory warning; it was removed because it re-flagged every un-run fixture in the repo on every e2e PR — pure noise.

The e2e `.ann.json` is written by the `/grade-e2e-run` skill (blind grading), **not** the CRUD UI — see the "never hand-write" note above, which is scoped to *unit* annotations.

## Model Pinning

The skill harness pins a specific model per skill via `model:` in `packages/engine/plugin/skills/<skill>/SKILL.md` frontmatter (when set). Activating a run log restores that field along with the rest of the snapshot. The `model` field on the run log envelope records what the harness actually used.

`judge_model` is project-global, not per-run-versioned — bumping the judge model is a separate decision that invalidates historical comparisons.

Judge temperature is pinned to 0 (`harness/judge.py::JUDGE_TEMPERATURE`) — project-global like `judge_model`, not recorded per run. Adopted 2026-07-16: grades drawn before that date (at the API default of 1.0) are not comparable to grades after it.

## What This Framework Does NOT Cover

- MCP tool code correctness (use Vitest in `packages/engine/mcp-server/tests/`)
- Description optimization (automated, see `docs/skill-mcp-testing-plan.md` Appendix C)
- Grading prompt optimization (automated, see same)
- Network/integration testing of MCP tools (use `packages/engine/mcp-server/dev/try-*.ts`)

## Eval vs production parity

The harness is deliberately *not* a perfect reproduction of how skills run in Cowork. A passing eval suite does not guarantee identical production behavior. The known divergences:

- **`setting_sources=["project"]`.** Production loads `["user","project"]`. Eval omits `"user"` so a developer's `~/.claude/skills/` doesn't contaminate routing tests.
- **No `temperature=0` on the skill run.** The installed `claude-agent-sdk` doesn't expose a `temperature` field, so the skill under test samples freely and variance leaks into single-run outcomes — fine for PR gates, matters for description-optimizer / golden-set work (bump `runs_per_test`). The judge *is* pinned (see "Model Pinning"), so this jitter is the skill's behavior, not its grade.
- **Mock MCP server.** Production hits real APIs; eval hits in-process mock responses from `eval/fixtures/mcp/`. Argument-quality grading is approximate.
- **Sandboxed workspace.** Production runs in Cowork's VM with its egress allowlist; eval runs in a tempdir on the host.
- **Concurrent execution.** Eval runs tests through a bounded thread pool *within a single invocation* (RAM-aware default ~4–8 slots; override with `--concurrency N`, or `--concurrency 1` to force serial). Tests are submitted **longest-first** (estimated from each test's `max_wall_clock_seconds` cap) so a long-pole test can't land in the last wave and stretch the makespan tail. To cover several skills, pass them to **one** invocation — `--skill a b c` (or `make eval-skill SKILL="a b c"`); each skill still writes its own releasable run log and they all share the one pool. **Still avoid running multiple `run_tests.py` invocations concurrently from the shell on one machine** — each spawns its own Claude Code SDK subprocess and the parallel memory pressure has been observed to trigger SIGKILL (`exit code -9`); the in-process pool (one invocation, many skills) is the safe way to parallelize. The retry mechanism recovers most transient stalls.

End-to-end fidelity testing happens via the layered testing playbooks in `docs/testing-guides/*.md`, not in this eval framework.

## Workflow

See `docs/plan/eval-runlog-versioning.md` for the canonical release/active/candidate workflow and `docs/plan/per-pr-review-workflow.md` for the per-PR cadence (junior authors tests, runs harness, corrects LLM grades, submits PR; senior reviews and releases the candidate).
