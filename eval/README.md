# Eval Framework

Systematic evaluation of Cowork Genealogy skills. Tests live as version-controlled JSON; the harness runs them against the Claude Agent SDK; an LLM judge grades each run; humans verify the grades through the CRUD UI. See [`docs/gps/skill-mcp-testing-plan.md`](../docs/gps/skill-mcp-testing-plan.md) for the strategic plan, [`docs/specs/unit-test-spec.md`](../docs/specs/unit-test-spec.md) for the test format, and [`docs/plan/eval-runlog-versioning.md`](../docs/plan/eval-runlog-versioning.md) for the run-log versioning and release workflow.

New to how skills are built, tested, and improved? Start with the lifecycle map: [`docs/skill-lifecycle.md`](../docs/skill-lifecycle.md).

## Directory layout

```
eval/
  harness/         Python test harness (Claude Agent SDK)
    harness/      Implementation modules (snapshot, versioning, runlog, …)
    scripts/      GH-action helpers (check_runlogs.py, check_tool_coverage.py)
    validators/   Per-skill deterministic validators
    judge/        LLM-judge prompt (prompt.md) — project-global, separately hashed
    e2e/          E2e orchestrator, judge, and CLI
    tests/        Harness's own unit + e2e tests
  fixtures/
    scenarios/    Shared project-state fixtures (research.json + tree.gedcomx.json)
    mcp/          Mocked MCP tool response fixtures
  tests/
    unit/<skill>/   Test definitions per skill + rubric.md
    e2e/            GPS proof-statement tests (each in its own directory)
  runlogs/         Harness output; see "Run log naming" below
  app/             Next.js CRUD UI for test authoring, annotation, comparison
  briefs/          Per-skill briefs: <skill>.md deep-dive/coverage (tester orientation)
                   + shorten-<skill>.md SKILL.md-shortening briefs (shorten-skills-overview.md indexes them)
  slides/          Kickoff + onboarding decks
  Setup.bat        Windows: one-time setup
  Start.bat        Windows: launch the CRUD UI
  RunTests.bat     Windows: run the unit harness
  Login.bat               Windows: FamilySearch login for e2e (once a day)
  CheckSetup.bat          Windows: e2e preflight (run this first)
  RunE2E.bat              Windows: run one e2e benchmark fixture (live FS)
  ViewE2E.bat             Windows: load the latest e2e run into the Research Viewer
  ValidateFixture.bat     Windows: e2e stripping linter
  ScratchResearch.bat     Windows: set up a throwaway dir to debug /research by hand
  SeedProject.bat         Windows: seed an editable Cowork project from a fixture (debug /research live)
  Viewer.bat              Windows: launch the Research Viewer (Electron)
  BuildMcpb.bat           Windows: build the .mcpb desktop extension (for the Cowork debug loop)
  BuildPlugin.bat         Windows: build the Cowork plugin .zip (for the Cowork debug loop)
  RunCalibration.bat      Windows: run judge calibration (maintainer only)
```

The `CheckSetup` / `*E2E* / `Fixture` / `*Calibration*` batch files drive
the e2e benchmark; see
[`docs/e2e-testing-guide.md`](../docs/e2e-testing-guide.md).

`eval/CLAUDE.md` is the agent-facing guide for working inside this directory (conventions, file types, what's where). Read it when modifying eval files.

## Prerequisites

- **Python 3.11+** with [uv](https://github.com/astral-sh/uv) (`pip install uv` or `brew install uv`).
- **Node.js 20+** with npm.
- **Claude Code CLI** — required. The harness drives the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python), which spawns the `claude` CLI as a subprocess. Install once:
  ```
  npm install -g @anthropic-ai/claude-code
  ```
  Then run `claude` once to authenticate (browser login or paste an API key). `Setup.bat` installs the CLI for you on Windows; macOS/Linux users do this step manually. If `claude --version` returns "not recognized," the harness will fail every test with a misleading "Claude Code returned an error result: success" error even though the SKILL.md, fixtures, and tests are fine.
- **Anthropic API key** — required for the LLM judge (the Anthropic SDK has no subscription path). `Setup.bat` will prompt for the key and save it to `eval/.env`; you can also put it there directly:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Or set it in your shell. The **skill runner** prefers your Claude Code subscription (`~/.claude/`) when one is available, billing it rather than the metered key, and only falls back to the API key when no subscription session is found. The judge always uses the key regardless. See `eval/harness/harness/auth.py` for resolution rules.

## Running manually (macOS / Linux)

The Windows batch scripts wrap a few `uv` / `npm` commands. On macOS or Linux, run them directly:

### Test harness

The harness loads the MCP server's compiled JS from
`packages/engine/mcp-server/build/`. Build it first — and again after any pull
that touches MCP source — or the harness exits 2 with "mcp-server build is stale
or missing":

```bash
cd packages/engine/mcp-server && npm install && npm run build
```

Or skip the manual build: from the repo root, **`make eval-skill SKILL=<name>`**
rebuilds the engine only when its source changed, then runs the harness for that
skill (a releasable full-skill run). The steps below are the manual equivalent.

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
```

Tests run serially (~30s/test). Scope runs with `--skill`, `--test`, or `--tag` — running the full suite at once is expensive and is reserved for release-time validation.

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

- `--list-skills` — list every skill directory that has at least one runnable test JSON, then exit.
- `--runlogs-root <dir>` — write run logs somewhere other than the default. Useful for one-off experiments that shouldn't pollute the committed tree.
- `--tests-dir <dir>` — point the harness at a non-default test corpus.
- `--max-cost-usd <n>` — suite-wide spend cap. Default 50. When projected cost exceeds it the remaining tests are skipped; the run still exits on the outcomes seen so far, so a capped run can exit 0 without covering the whole suite.
- `--max-wall-clock-seconds <n>` — suite-wide wall-clock cap. Default 14400 (4 hours). Same skip-the-rest behavior as the cost cap.

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

Run logs live at `eval/runlogs/unit/<skill>/<filename>`. There is no model dir — the model the run executed against is stored in the run-log JSON's `model` field and in `packages/engine/plugin/skills/<skill>/SKILL.md` frontmatter.

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

- `schema_version` (currently `2`), `skill`, `version`, `released`, `releasable`, `invocation`, `timestamp`, `model`, `harness_version`.
- `judge_prompt_hash` — SHA-256 of the normalized `eval/harness/judge/prompt.md` at run time (NOT in the snapshot — the judge prompt is project-global, so it's tracked separately so judge edits don't clobber every skill on activate).
- `snapshot` — `{repo-relative-path: normalized-content}` of every skill-side file used to produce this run (`packages/engine/plugin/skills/<skill>/**`, `eval/tests/unit/<skill>/**`, referenced scenarios + fixtures, and the whole MCP source tree `packages/engine/mcp-server/src/**`). The active-state check compares this map to the working tree, so an MCP code change also makes prior run logs inactive and forces a re-run.
- `tests[]` — per-test entries:
  - `outcome` (`pass | partial | fail | aborted | xfail | xpass`)
  - `flaky`, `outcome_summary.aggregated_dimensions[]` (1–3 per-dimension scores)
  - `runs[]` — per-execution detail: `output.text_response`, `tool_calls`, `validators`, `judge.dimensions[]` with rationales
- `totals` — token + cost aggregates summed across tests.

The CRUD UI's run-log detail page (`/results/<skill>/<filename-without-ext>`) is the primary reading surface. Raw JSON inspection is the fallback for harness debugging.

## CRUD UI day-to-day

- **`/results`** — every committed run log grouped by skill, with version badges and annotation status.
- **`/results/<skill>/<filename-without-ext>`** — integrated test-centric view: per-test trace (input, scenario card, tool calls + fixtures, output) and grade block with per-dimension correction + comment + 📋 "copy as PR comment" button. Activate / Release / Delete actions live in the header. The "active" indicator marks the run log whose snapshot matches the working tree.
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
2. Junior runs `make eval-skill SKILL=<skill>` (or `cd eval/harness && uv run python run_tests.py --skill <skill>`) → harness writes a `v{N}_<ts>.json` candidate.
3. Junior opens the CRUD UI, reviews every dimension on the latest candidate (sparse `.ann.json` becomes complete).
4. Junior commits the candidate + annotation, pushes the PR.
5. GH Action enforces (blocking): ≤1 added released file, latest full-skill run log is active on skill-side files (snapshot matches working tree), and its `.ann.json` is complete. Two warn-only checks also run and do not block merge: tool-coverage drift (`check_tool_coverage.py` — a skill declaring a tool with no fixture) and a judge-prompt-hash match (rule 2b).
6. Senior reviews via GitHub diff + the CRUD UI compare page. Disagreements go to PR comments via the 📋 button.
7. Senior clicks **Release** on the active candidate → `v{N}_<ts>.json` → `v{N}.json` rename. Commits, pushes, approves.
8. Project owner merges.

## Cosmetic-change exemption (skip the re-run for a minor wording change)

A PR reviewer asks for a one-word rewording or a typo fix in a `SKILL.md`.
That edit changes the skill-side snapshot, which flips the latest run log
**inactive** — so by default the gate (rule 2) demands a full harness re-run
(~$1–3) *and* a complete re-grade, even though the behavior can't have
changed. A senior can waive that for a genuinely behavior-neutral edit by
applying a **PR label** — no branch checkout, no commands, nothing to install.

**It exempts the PR from both:** no harness re-run, and no re-correcting
scores. The prior run log stays the active one, and its already-complete
`.ann.json` satisfies the completeness rule as-is. (Only rule 2 is relaxed —
rules 1 and 3 still run, so an *unannotated* baseline can't be waved through.)

**Use it only for genuinely behavior-neutral edits** — rewording, typos,
comments, formatting. If a change *could* alter what Claude does (a new
instruction, a reordered step, a changed tool argument, an edited fixture or
scenario), it is **not** cosmetic: re-run the harness.

### How a senior sets the flag (entirely in the GitHub web UI)

1. Open the PR on github.com.
2. In the right-hand sidebar, under **Labels**, add **`eval-cosmetic-skip`**.
3. (Recommended) leave a one-line comment saying *why* it's behavior-neutral —
   e.g. "Reworded step 3 'Look for' → 'Search for'; no behavior change." The
   label records *who* and *when*; the comment records *why*.

The `Check runlog discipline` check re-runs automatically when the label is
added and turns green, with a warning noting the bypass so reviewers see it.

### Safety: the label auto-expires on every new push

The label is **removed automatically whenever a new commit is pushed** to the
PR. So a waiver can never silently cover a *later* substantive change — if more
commits land, the check goes red again and the senior must re-apply the label
(after confirming the new commits are still cosmetic). This is the same
"voids on any further edit" guarantee a re-run would give, with none of the
work.

### One-time repo setup

The label has to exist before anyone can apply it. An admin creates it once:

```bash
gh label create eval-cosmetic-skip \
  --description "Senior waiver: skill change is behavior-neutral; skip the eval re-run" \
  --color FBCA04
```

Seniors need **Triage** or **Write** access on the repo to apply labels.

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
- **Runlogs:** a passing run commits as `runlogs/e2e/<test-id>/run-<timestamp>.*`; non-passing runs write as gitignored `scratch_<timestamp>.*`.

### Authoring a new fixture

Fixtures are authored interactively with the **`/author-e2e-fixture`**
skill (in `.claude/skills/`), run from the **Code tab** of the Claude
desktop app (or `claude` in a terminal) opened at the **repo root** —
not in Cowork, and not a subfolder. The skill needs the host-side MCP
tools `person_read` + `validate_research_schema`; the committed
`.mcp.json` at the repo root wires up the `genealogy` MCP server, which
you **approve once** on first open of the repo.

Each step shows the Windows batch file with the macOS/Linux `make`
equivalent in parentheses:

1. **Once per machine:** `git pull`, then `eval\Setup.bat` (Mac:
   `make install` for first-time setup — `make engine-build` is just the
   rebuild after a later pull). Mac also needs `ANTHROPIC_API_KEY` in
   your shell or `eval/.env` for the judge in step 7; `Setup.bat` prompts
   for it on Windows.
2. **Daily:** `eval\Login.bat` (`make e2e-login`) — FamilySearch login
   (~24h token).
3. *(recommended)* `eval\CheckSetup.bat` (`make e2e-preflight`) —
   readiness check before you spend money.
4. Open the **`cowork-genealogy`** folder (repo **root**) in the Claude
   desktop **Code tab** — or `claude` at the repo root. **Approve** the
   `genealogy` MCP prompt on first open (restart an already-open session
   so it loads `.mcp.json`).
5. `/author-e2e-fixture` → give a **deceased** person's FamilySearch ID
   → pick the one subset to strip → answer the metadata questions. Writes
   straight to `eval\tests\e2e\<slug>\` — no move needed.
6. `eval\ValidateFixture.bat` → enter the slug (`make e2e-validate
   TEST=<slug>`) → resolve any `WARN`.
7. `eval\RunE2E.bat` → enter the slug (`make e2e-run TEST=<slug>`) →
   live run (20–60 min, $3–10).
8. `/interpret-e2e-result` → read the verdict.
9. `eval\ViewE2E.bat` → enter the slug (`make e2e-view TEST=<slug>`) → launch
   the Research Viewer with `eval\Viewer.bat` (`make electron`) and open
   `eval\e2e-view` in it (its **Open Project** button) to inspect the agent's
   final tree, research log, and each finding's direct/indirect badge. Keep the
   viewer open — re-running `ViewE2E.bat` refreshes it live.
10. If it passes, commit the fixture (and optionally its run log), and
   open a PR.

### Debug a fixture interactively (Cowork + the viewer)

Before — or instead of — a headless `RunE2E.bat`, run the fixture **live in
Claude Cowork** and watch it unfold. This is the recommended starting point
for debugging *why* the agent did or didn't do something, and it keeps the
test-improve loop fast: you watch the fix work in minutes instead of waiting
20–60 min for a headless verdict.

**First time (and after any skill or MCP-server change):** build and install
the two artifacts so Cowork has the genealogy tools — `eval\BuildMcpb.bat`
(`make mcpb`), then install the `.mcpb` in Claude Desktop → Settings →
Extensions; and `eval\BuildPlugin.bat` (`make plugin`), then upload the plugin
in Cowork → Customize → Browse plugins. **Fully quit and reopen** Claude
Desktop after installing. The headless `RunE2E.bat` path doesn't use these (it
runs the compiled engine directly), so this is only for the live Cowork loop.

1. `eval\SeedProject.bat` → enter the slug (`make e2e-project TEST=<slug>`).
   Copies the fixture's starting state into `eval\e2e-project\<slug>\` as a
   fresh, editable `research.json` + `tree.gedcomx.json`.
2. Open that folder in **Claude Cowork** (genealogy plugin installed, logged
   in to FamilySearch) and run `/research`. `init-project` is auto-skipped
   (research.json already exists); question-selection still runs unless the
   fixture seeds a question.
3. Launch the Research Viewer — `eval\Viewer.bat` (`make electron`) — and open
   the **same folder** in it (its **Open Project** button) to watch the
   research log, assertions, and conflicts appear live — and ask Claude *"why
   didn't you search X?"*, *"why direct, not indirect?"* as it works.

**For understanding, not scoring.** A live run does **not** block the tree-read
tools (`person_read` / `person_search` / `person_ancestors`) that the headless
`make e2e-run` blocks — so confirm the agent found the answer by *searching
records*, not by reading the live tree. The honest pass/fail is always the
headless run. Re-seed a fresh project (wiping any work) with `FORCE=1`.

### Keep the machine awake during a run

A run is long (20–60 min) and the machine must **not sleep** partway through.
If it does, the work pauses until the machine wakes — the result is still
valid, but the run takes much longer in real time. The harness measures
**active** time (so a sleep does not corrupt the wall-clock metric) and prints
a `machine slept ~N min` note when it detects one — treat that note as your cue
to set one of these up:

- **Windows:** there's no per-command keep-awake tool, so set the power plan
  once — `powercfg /change standby-timeout-ac 0` (add `powercfg /change
  monitor-timeout-ac 0` to keep the display on), or Settings → System → Power →
  "When plugged in, put my device to sleep → Never".
- **macOS:** prefix the run with `caffeinate` — `caffeinate -i make e2e-run
  TEST=<slug>` (holds off idle sleep until the run exits). On an always-on
  machine (e.g. a Mac mini) set System Settings → Energy → "Prevent automatic
  sleeping when the display is off" once instead.
- **Linux:** prefix with `systemd-inhibit --what=idle:sleep make e2e-run
  TEST=<slug>`, or disable sleep in your desktop's power settings.

A closed laptop lid can still sleep regardless of the above (clamshell) — keep
the lid open unless you're on power with an external display.

## Related specs

- `docs/plan/eval-runlog-versioning.md` — Run-log versioning + active/release workflow (canonical).
- `docs/specs/unit-test-spec.md` — Unit-test JSON format + harness behavior.
- `docs/specs/e2e-test-spec.md` — E2e test format + judge contract.
- `docs/specs/eval-crud-ui-spec.md` — CRUD UI design.
- `docs/specs/research-schema-spec.md` — `research.json` schema.
- `docs/specs/simplified-gedcomx-spec.md` — `tree.gedcomx.json` schema.
- `docs/specs/schemas/` — Machine-readable JSON schemas referenced above.
- `docs/eval-rollout.md` — Active rollout plan and decision log.
