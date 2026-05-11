# Eval Framework

Systematic evaluation of GeneFun skills through automated testing with human verification.

## Directory Layout

```
eval/
  CLAUDE.md              This file
  Setup.bat              One-time setup (uv, npm, API key)
  Start.bat              Launch the Next.js test-creation/annotation app
  Run Tests.bat          Execute the Python test harness
  app/                   Next.js CRUD app for test creation and annotation
  harness/               Python test runner (Claude Agent SDK)
    validators/          Developer-written deterministic validators (one file per skill)
  fixtures/
    scenarios/           Shared project state fixtures (research.json + tree.gedcomx.json)
    mcp/                 Mocked MCP tool response fixtures
  tests/                 Test definitions (version-controlled source of truth)
    e2e/                 GPS proof statement tests (each in its own directory)
    unit/
      <skill-name>/      One directory per skill (matches plugin/skills/)
        rubric.md        Skill-specific grading dimensions
        *.json           Genealogist-written test files
  runlogs/               Generated test output + human annotations
    e2e/
    unit/
      <skill-name>/      Mirrors tests/unit/ structure
```

## What Belongs Where

- **`tests/`** — Test case definitions. These are the source of truth.
  Always version-controlled. Never generated.
- **`runlogs/`** — Generated output from test runs, plus human
  annotations and senior adjudications. Selectively committed
  (canonical runs are committed; local draft runs may be gitignored).
- **`app/`** — The Next.js app juniors use to create tests, view
  results, and annotate run logs.
- **`harness/`** — The Python test runner that calls Claude Agent SDK
  to execute tests and write run log files.
- **`harness/validators/`** — Developer-written Python validators
  (one `test_*.py` file per skill). Run automatically by the harness
  after each test execution. Results visible in the CRUD UI.
- **`fixtures/scenarios/`** — Shared project state fixtures. Each
  scenario is a directory with `research.json`, `tree.gedcomx.json`,
  and `README.md`. Tests reference scenarios by directory name.
- **`fixtures/mcp/`** — Mocked MCP tool response fixtures. Each
  fixture is a single JSON file with `tool`, `description`, and
  `response` fields. Tests reference fixtures by filename.

## Three Testing Layers

This eval framework is one of three complementary testing layers:

1. **Vitest** (`mcp-server/tests/`) — Tests whether MCP tool code
   works correctly. Developers maintain these.
2. **Skill evals** (this framework) — Tests whether Claude performs
   genealogy tasks well when using skills, including tool usage.
   Genealogists create, run, and grade these.
3. **Prompt optimizers** (automated) — Two optimizers that consume
   eval results to improve prompts, both running unattended:
   - **Description optimizer** — Hill-climbs the `description` field
     on skill and MCP tool definitions so Claude triggers them
     correctly (should-fire / should-not-fire test sets).
   - **Grading prompt optimizer** — Improves LLM judge rubrics and
     prompts so automated grading aligns with human corrections
     (targets dimensions where juniors frequently disagree with the
     LLM judge).

Skill evals include tool-usage rubric dimensions (did Claude call the
right tool? good arguments? used the response correctly?) so there is
no separate MCP tool eval suite for genealogists to maintain.

## Naming Conventions

### Test files

Test definitions live in `tests/unit/<skill-name>/` and
`tests/e2e/`. Format defined in `docs/specs/unit-test-spec.md`
and `docs/specs/e2e-test-format-spec.md`.

```
tests/unit/locality-guide/alabama-1850s-collections.json
tests/e2e/gps-proof-adopted-child.json
```

### Run logs

The test harness writes one file per test run into the corresponding
`runlogs/` directory. Organized by model version and named by
timestamp:

```
runlogs/unit/locality-guide/<model-version>/
  2026-05-10-14-30-00.json
```

### Annotations

Junior genealogists annotate run logs to verify LLM grading. An
annotation file sits alongside the run log it annotates, using the
`.ann.<github-username>.json` suffix:

```
runlogs/unit/locality-guide/
  2026-05-10-14-30-00.json                    # raw run log
  2026-05-10-14-30-00.ann.kwame.json          # annotation by kwame
  2026-05-10-14-30-00.ann.fatima.json         # annotation by fatima
```

Multiple juniors may annotate the same run (for inter-rater
reliability and senior adjudication).

### Adjudications

When annotations disagree, a senior genealogist adjudicates. The
adjudication file uses the `.adj.<github-username>.json` suffix:

```
runlogs/unit/locality-guide/
  2026-05-10-14-30-00.json                    # raw run log
  2026-05-10-14-30-00.ann.kwame.json          # kwame's annotation
  2026-05-10-14-30-00.ann.fatima.json         # fatima's annotation
  2026-05-10-14-30-00.adj.dallan.json         # senior adjudication
```

### How to tell what needs work

- A run log with **no `.ann.*` siblings** = unannotated (needs junior review)
- A run log with **2+ `.ann.*` siblings but no `.adj.*`** = needs senior adjudication
- A run log with **`.adj.*`** = fully reviewed

### File content conventions

- **Run log JSON** contains: test case reference, model version,
  timestamp, raw LLM output, deterministic check results, LLM judge
  scores. Schema TBD.
- **Annotation JSON** contains: annotator (GitHub username), timestamp,
  binary verdict (agree/disagree with LLM grade), disagreement category
  (from escalation taxonomy), free-text explanation. Schema TBD.
- **Adjudication JSON** contains: adjudicator (GitHub username),
  timestamp, which annotations it resolves, final verdict, rationale.
  Schema TBD.

Filenames are for human scanning (ls, GitHub file browser).
Structured metadata lives inside the JSON.

## Model Pinning

The test harness pins a specific model version (e.g.,
`claude-sonnet-4-6-20250514`) to minimize variance between local and
canonical runs.

## What This Framework Does NOT Cover

- MCP tool code correctness (use Vitest in `mcp-server/tests/`)
- Description optimization (automated, see testing plan)
- Grading prompt optimization (automated, see testing plan)
- Network/integration testing of MCP tools (use `mcp-server/dev/try-*.ts`)
