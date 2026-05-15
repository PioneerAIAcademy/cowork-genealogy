# Eval CRUD UI Specification

**Project:** GeneFun AI genealogy research assistant
**Scope:** Next.js app for creating, managing, and reviewing eval tests, scenarios, fixtures, and run results
**Status:** Draft — structure and key decisions captured, implementation TBD. Aligned to `docs/plan/per-pr-review-workflow.md` (per-PR per-skill iteration model).

---

## 1. Overview

A Next.js app at `eval/app/` that junior genealogists use to:

1. Create, edit, and manage unit tests and e2e tests
2. Create, edit, and manage scenario fixtures and MCP fixtures
3. View run log results
4. Annotate run logs with numeric (1–3) corrections to LLM judge grades
5. Compare a PR's results against main side-by-side

The app reads and writes JSON files to disk (`eval/tests/`, `eval/fixtures/`, `eval/runlogs/`). It is the primary interface for non-technical genealogists — they should never need to edit JSON directly or use the terminal.

Test execution happens outside the UI — juniors run the harness via `RunTests.bat` (Windows) or `uv run python run_tests.py` (CLI). The UI surfaces new run logs via refresh-on-focus (§6). Phase 2 may add an in-UI launch-and-watch button if alt-tab friction proves real.

---

## 2. Navigation

Three primary CRUD interfaces plus supporting views:

| Section | What it manages | Primary users |
|---------|----------------|---------------|
| **Tests** | Unit test and e2e test JSON files | Junior genealogists |
| **Scenarios** | Project state fixtures (research.json + tree.gedcomx.json) | Junior genealogists (Phase 2), devs (Phase 1) |
| **Fixtures** | MCP tool response fixtures | Junior genealogists (Phase 2), devs (Phase 1) |
| **Results** | Run logs + `.ann` annotations + cross-PR comparison view | Junior + senior genealogists |

### Cross-references

- Each test links to its scenario and MCP fixtures
- Each scenario shows which tests reference it (reverse lookup)
- Each fixture shows which tests reference it (reverse lookup)
- Each run log links to the test that produced it
- Reverse lookups help users understand impact before editing a shared scenario or fixture

---

## 3. Tests Section

### Authoring flow

A junior creating a new test moves through these steps in the Create view:

1. Pick the skill from the dropdown (populated from `plugin/skills/`).
2. Choose positive or negative test type.
3. Write a short name, 1-2 sentence description, and tags.
4. Pick a scenario from the dropdown (skipped for stateless skills). If no scenario matches:
   - Pick the closest one and write `scenario_notes` describing the gap.
   - The test saves with status "needs-scenario" and is blocked by the runnability gate until a matching scenario exists (see `unit-test-spec.md` §9).
   - **Closing the loop:** once a dev creates the needed scenario, the test author edits the test to point at the new scenario name and clears `scenario_notes`. The status badge flips to "runnable" and the test joins the next harness run.
5. Pick MCP fixtures from the dropdown (only shown for skills with `allowed-tools`). Same fall-back as scenarios: pick closest + describe gap in `scenario_notes`.
6. Write the `user_message`.
7. For positive tests: write `additional_criteria` as plain-English sentences. The sidebar shows the skill's rubric dimensions (parsed from `rubric.md` per `unit-test-spec.md` §7) so the author knows what's already covered and avoids duplicating.
8. For negative tests: pick the `correct_skill` and write the boundary `explanation`.

The form maps directly to the unit test JSON schema (see §3 below for the field mapping). Validation runs on save against `docs/specs/schemas/unit-test.schema.json`.

### AI-assisted bulk authoring

The Tests section includes a "Generate draft tests from skill" action that:

1. Reads the chosen skill's SKILL.md (`Use when`, `Do NOT use when`, workflow description, allowed-tools).
2. Asks an LLM to generate 10-20 draft positive and negative tests covering the skill's main use cases and confusable-skill boundaries.
3. Saves drafts to a staging queue inside the app (not committed to `eval/tests/unit/` yet).
4. The author reviews each draft, refines the criteria, and either accepts (moves to `eval/tests/unit/` as a regular test JSON) or discards.

Drafts are LLM-generated starting material, not authoritative tests. The author owns the final shape; the LLM just bootstraps the volume.

### List view

- Filter by: skill (dropdown), type (positive/negative), tags (multi-select)
- Sort by: name, skill, date created
- Show: test name, skill, type, tag chips, scenario name, status indicator (runnable / needs-scenario / needs-fixture)
- A test is "runnable" when its referenced scenario exists and all referenced MCP fixtures exist. Tests with `scenario_notes` describing missing state show "needs-scenario" status.

### Create/Edit view

Form fields mapped to the unit test JSON schema (see `docs/specs/unit-test-spec.md` Section 4):

| Field | UI control | Notes |
|-------|-----------|-------|
| skill | Dropdown | Populated from plugin/skills/ directory listing |
| name | Text input | |
| type | Toggle: positive / negative | Controls which fields are shown |
| description | Text area | |
| tags | Tag input (autocomplete from existing tags) | |
| user_message | Text area | |
| scenario | Dropdown + "Create new" button | Shows scenario README description on hover/select |
| scenario_notes | Text area (collapsible) | Shown when scenario doesn't exactly match |
| mcp_fixtures | Multi-select dropdown + "Create new" button | Only shown for skills with allowed-tools |
| additional_criteria | Repeatable text inputs (add/remove) | Shown for both positive and negative tests |
| negative.correct_skill | Dropdown (multi-select) | Only shown when type = negative; empty array = no skill should fire |
| negative.explanation | Text area | Only shown when type = negative |

The form displays the skill's rubric dimensions (from rubric.md) in a sidebar or info panel so the genealogist knows what's already covered and can write additional_criteria that don't duplicate the rubric.

**Hash-change warning on edit.** When the junior edits an existing test and changes a grading-relevant field (`user_message`, `scenario`, `mcp_fixtures`, `additional_criteria`, `negative`), the UI shows an inline warning: "This edit changes the test's content hash — it will be excluded from cross-PR comparison for one PR. Continue?" Cosmetic edits (`name`, `description`, `tags`) don't trigger the warning. The warning is advisory only — the junior may proceed. The senior reviewing the PR sees the diff and decides whether to ask for a revert. Per plan §2.4.

### Validation

The app validates against the JSON schema from unit-test-spec.md on save. Validation errors shown inline next to the offending field.

---

## 4. Scenarios Section

### List view

- Show: scenario name, description (from README.md), number of tests referencing it
- Sort by: name, usage count

### Create/Edit view (Phase 2)

Form-based scenario builder. The UI provides fields for each research.json section, generating valid JSON behind the scenes. Sections shown based on which skill the test targets (derived from the ownership table in research-schema-spec.md).

Phase 1: scenarios are read-only in the UI (created by devs). The UI displays the README and allows browsing the JSON content but not editing.

### Detail view

- Rendered README.md
- Collapsible JSON viewer for research.json and tree.gedcomx.json
- List of tests that reference this scenario (clickable)

---

## 5. Fixtures Section

### List view

- Show: fixture name, tool name, description, number of tests referencing it
- Filter by: tool name
- Sort by: name, tool, usage count

### Create/Edit view (Phase 2)

Two creation modes:
- **URL capture:** Paste a record URL, app calls the MCP tool against live API, saves the response
- **Manual entry:** Form fields for the response shape (varies by tool)

Phase 1: fixtures are read-only in the UI (created by devs). The UI displays the fixture content but not editing.

### Detail view

- Tool name, description
- Collapsible JSON viewer for the response
- List of tests that reference this fixture (clickable)

---

## 6. Results Section

Per the per-PR review workflow (`docs/plan/per-pr-review-workflow.md`), the team submits one PR per skill containing the updated skill prompt, tests, one run log, and one `.ann` file (per skill touched). Senior feedback flows through PR comments. There is no separate adjudication artifact.

### Results home

The Results section opens to a dashboard with two panels:

- **Recent run logs widget.** Top 5–10 run logs across all skills, sorted by timestamp descending. Each row shows: skill, model, timestamp, weighted-mean score, annotation status (annotated / unannotated). Color-coded outcome (green = pass, yellow = partial, red = fail/aborted). Click a row to jump to the run detail view. This is the junior's primary "is there new work?" landing.
- **Filter + full list** below the widget — same filters as before (skill, model version, date range, annotation status).

**Refresh-on-focus.** When the browser tab regains focus (e.g., the junior alt-tabs from a terminal where `RunTests.bat` just finished), the Results section auto-refreshes its run-log list. Implemented via `visibilitychange` event listener — when the document becomes visible, refetch the run-log index. This closes the "did my run finish?" loop without polling.

### Run list view

- Filter by: skill, model version, date range, annotation status (annotated / unannotated)
- Show: test name, skill, model version, timestamp, weighted-mean score, annotation status, run outcome
- Annotation status derived from file naming convention (`.ann.json` file alongside the run log)

### Run detail view

- Full run log content: test metadata, skill output, deterministic results, LLM judge scores per dimension
- Side-by-side: skill output vs expected behavior (criteria + rubric dimensions)
- **Partial-judge guard:** if any test in the run log has `judge.skipped: true` with an error (LLM judge crashed on that test), the annotation view refuses to open. A clear message explains that the team must re-run the harness until every test has judge scores before annotating. Per plan §2.13.

### Annotation view

- Each rubric dimension and additional criterion shown with the LLM judge's integer score (`1`–`3`, where `3` = pass, `2` = partial, `1` = fail). The score is read directly from the run log — no enum-to-integer mapping happens at display time.
- For each dimension, an editable `corrected_score` field (integer 1–3) defaults to the LLM's score; the junior changes only the dimensions they disagree with.
- Optional `comment` text area per dimension — expected on disagreement, omitted on agreement.
- Save writes `<run-log-timestamp>.ann.json` alongside the run log. Schema: `docs/specs/schemas/ann.schema.json`.
- Every dimension of every test in the run log gets an entry — agreement (`corrected_score == llm_score`) is computed, not stored as a separate flag. See plan §2.3.

### Comparison view (cross-PR)

- For a given skill, shows the current PR's run log side-by-side with main's most recent run log for that skill.
- Both sides display: weighted mean, count histogram (number of `3`s / `2`s / `1`s across all dimensions), and per-dimension breakdown.
- Per-test rows: tests in both run logs are listed once, with their corrected weighted means on each side. Tests whose `test_content_hash` differs between the two run logs are flagged "edited — excluded from headline comparison" and visually de-emphasized; the senior can still inspect them individually.
- **Within-variance advisory:** when the weighted-mean delta between PR and main is below 0.3, the comparison view displays "within typical run-to-run variation — interpret cautiously." Advisory only; the senior decides what to make of it. Either party can re-run the harness for a second sample via the Python script. Per plan §2.10.
- No statistical gate; no auto-merge. The senior reviews holistically (prompt diff + test diff + `.ann` + comparison) and accepts or rejects the PR through standard GitHub UI.

### What's NOT in this section

- **No "Run tests" button.** Multi-minute test runs are a poor fit for synchronous HTTP. Juniors run tests via `RunTests.bat` (Windows) or `uv run python run_tests.py` (CLI); the CRUD UI detects the new run log via the refresh-on-focus mechanism above. Revisit in a v2 of the CRUD UI if the alt-tab friction proves real.
- **No adjudication view.** Senior feedback flows through PR comments per the per-PR workflow; `.adj` files are gone.

---

## 7. Technical Decisions

### Data storage

The app reads and writes directly to the eval/ directory on disk. No database — the filesystem is the database. This means:

- Tests, scenarios, and fixtures are version-controlled via git
- The app must handle concurrent file access gracefully (multiple genealogists working simultaneously)
- File watching or polling for changes made outside the app (e.g., git pull bringing in new tests)

### Authentication

TBD. At minimum, the app needs to know the current user's GitHub username (for annotation filenames). Options range from a simple username prompt to GitHub OAuth.

### API routes

Next.js API routes for:
- CRUD operations on tests, scenarios, fixtures
- Listing and filtering across all three entity types
- Cross-reference queries (which tests use scenario X?)
- Run log listing and filtering
- Annotation and adjudication creation

---

## 8. Phased Build

### Phase 1 (launch)

- Tests: full CRUD with hash-change warning on grading-relevant edits
- Scenarios: read-only (display README, browse JSON, list referencing tests)
- Fixtures: read-only (display content, list referencing tests)
- Results: Results home with recent run logs widget + refresh-on-focus; list view with filtering; run detail view; annotation view (numeric 1-3 per dimension, `.ann.json` write); partial-judge guard
- Comparison view (cross-PR): side-by-side weighted mean + histograms with within-variance advisory
- No "Run tests" button (juniors run via `RunTests.bat` / CLI; refresh-on-focus surfaces new run logs)

### Phase 2

- Scenarios: full CRUD with form-based builder
- Fixtures: full CRUD with URL capture and manual entry
- Tag autocomplete across the test corpus
- Optional "Run tests" launch-and-watch button (spawns harness as background process, streams progress via SSE) — only build if juniors complain about the alt-tab friction
- Bulk operations (queue a re-run for failed tests, batch-edit tags)

---

## 9. Open Questions

- How should the app handle `scenario_notes` → scenario promotion (the "3+ tests need the same modification" rule)?
- What level of JSON schema validation should the scenario builder enforce? Full research-schema-spec compliance, or just structural validity?
- Authentication / user identity. The `.ann` file's `annotator` field needs a stable identifier (team name, GitHub handle, or session-bound prompt).

Resolved (covered above):

- *How does the app trigger test runs?* It doesn't. Juniors run the harness from the terminal / batch file; the CRUD UI's refresh-on-focus mechanism surfaces new run logs. Phase 2 may add an optional launch-and-watch button.
- *Should the app support real-time streaming?* Not in Phase 1. Phase 2 launch-and-watch button uses SSE if added.

---

## 10. Related Specs

- `docs/specs/unit-test-spec.md` — Unit test JSON format, JSON Schema, harness behavior, runnability gate, integer grade scale
- `docs/specs/schemas/ann.schema.json` — `.ann` file schema (the annotation view writes against this)
- `docs/specs/schemas/run-log.schema.json` — Run log schema (the Results section reads against this; includes `test_content_hash`)
- `docs/specs/e2e-test-spec.md` — E2e test format
- `eval/CLAUDE.md` — Directory layout, naming conventions, annotation file conventions
- `docs/specs/research-schema-spec.md` — Research.json schema (for scenario builder)
- `docs/specs/simplified-gedcomx-spec.md` — GedcomX schema (for scenario builder)
- `docs/plan/per-pr-review-workflow.md` — The workflow this UI implements
- `docs/gps/skill-mcp-testing-plan.md` — Master plan covering sequencing, team structure, senior review SLA, calibration, optimizer mechanics, and bootstrap scenarios
