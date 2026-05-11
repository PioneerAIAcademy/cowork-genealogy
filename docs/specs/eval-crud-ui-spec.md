# Eval CRUD UI Specification

**Project:** GeneFun AI genealogy research assistant
**Scope:** Next.js app for creating, managing, and reviewing eval tests, scenarios, fixtures, and run results
**Status:** Draft — structure and key decisions captured, detail TBD

---

## 1. Overview

A Next.js app at `eval/app/` that junior genealogists use to:

1. Create, edit, and manage unit tests and e2e tests
2. Create, edit, and manage scenario fixtures and MCP fixtures
3. Run tests and view results
4. Annotate (grade) run log results
5. View which runs need annotation and which need senior adjudication

The app reads and writes JSON files to disk (eval/tests/, eval/fixtures/, eval/runlogs/). It is the primary interface for non-technical genealogists — they should never need to edit JSON directly or use the terminal.

---

## 2. Navigation

Three primary CRUD interfaces plus supporting views:

| Section | What it manages | Primary users |
|---------|----------------|---------------|
| **Tests** | Unit test and e2e test JSON files | Junior genealogists |
| **Scenarios** | Project state fixtures (research.json + tree.gedcomx.json) | Junior genealogists (Phase 2), devs (Phase 1) |
| **Fixtures** | MCP tool response fixtures | Junior genealogists (Phase 2), devs (Phase 1) |
| **Results** | Run logs, annotations, adjudications | Junior + senior genealogists |

### Cross-references

- Each test links to its scenario and MCP fixtures
- Each scenario shows which tests reference it (reverse lookup)
- Each fixture shows which tests reference it (reverse lookup)
- Each run log links to the test that produced it
- Reverse lookups help users understand impact before editing a shared scenario or fixture

---

## 3. Tests Section

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
| negative.correct_skill | Dropdown | Only shown when type = negative |
| negative.explanation | Text area | Only shown when type = negative |

The form displays the skill's rubric dimensions (from rubric.md) in a sidebar or info panel so the genealogist knows what's already covered and can write additional_criteria that don't duplicate the rubric.

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

### Run list view

- Filter by: skill, model version, date range, annotation status (unannotated / annotated / needs-adjudication / adjudicated)
- Show: test name, skill, model version, timestamp, deterministic pass/fail count, LLM judge summary score, annotation status
- Annotation status derived from file naming convention (`.ann.` and `.adj.` files)

### Run detail view

- Full run log content: test metadata, skill output, deterministic results, LLM judge scores per dimension
- Side-by-side: skill output vs expected behavior (criteria + rubric dimensions)

### Annotation view

- Each rubric dimension and additional criterion shown with the LLM judge's score and rationale
- Junior provides: agree/disagree toggle per dimension, escalation category dropdown (if disagree), free-text explanation
- Save creates a `.ann.<github-username>.json` file alongside the run log

### Adjudication view (senior only)

- Shows all annotations for a run side-by-side
- Senior provides: final verdict, rationale, which annotations they agree with
- Save creates a `.adj.<github-username>.json` file

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

- Tests: full CRUD
- Scenarios: read-only (display README, browse JSON, list referencing tests)
- Fixtures: read-only (display content, list referencing tests)
- Results: list view with filtering, detail view, annotation view
- No adjudication view (seniors review annotations via GitHub PR)

### Phase 2

- Scenarios: full CRUD with form-based builder
- Fixtures: full CRUD with URL capture and manual entry
- Adjudication view
- Tag autocomplete across the test corpus
- Bulk test operations (run all tests for a skill, re-run failed tests)

---

## 9. Open Questions

- How does the app trigger test runs? Does it call the Python harness directly, or does the user run `RunTests.bat` separately and the app just displays results?
- Should the app support real-time test execution with streaming output, or is batch-and-review sufficient?
- How should the app handle scenario_notes → scenario promotion (the "3+ tests need the same modification" rule)?
- What level of JSON schema validation should the scenario builder enforce? Full research-schema-spec compliance, or just structural validity?

---

## 10. Related Specs

- `docs/specs/unit-test-spec.md` — Unit test JSON format and JSON Schema
- `docs/specs/e2e-test-format-spec.md` — E2e test format
- `eval/CLAUDE.md` — Directory layout, naming conventions, annotation/adjudication file conventions
- `docs/specs/research-schema-spec.md` — Research.json schema (for scenario builder)
- `docs/specs/simplified-gedcomx-spec.md` — GedcomX schema (for scenario builder)
