# Unit Test Format Specification

**Project:** GeneFun AI genealogy research assistant
**Scope:** Skill-level evaluation tests written by genealogists, graded by LLM judge + human verification

---

## 1. Overview

Each unit test exercises a single skill in isolation: given a project state and a user message, does the skill produce correct output? Unit tests are the primary vehicle for iterative skill improvement (Phases 1-3 in the testing plan). They are cheaper and faster than e2e tests.

There are two kinds of tests per skill:

- **Genealogist tests** (JSON files) — scenario-based tests created by junior genealogists via the CRUD UI. Graded by LLM judge using a three-layer rubric, then verified by humans.
- **Developer tests** (Python files) — deterministic structural validators written by developers. Run against the output of every genealogist test to catch schema violations, broken references, and ownership table breaches.

Unit tests serve two purposes:

1. **Skill quality** — Does the skill prompt guide Claude to produce correct genealogical output?
2. **Skill triggering** — Does the skill activate when it should and stay silent when it shouldn't?

The testing plan calls for 30+ tests per skill, split roughly 50/50 between positive (should-trigger) and negative (should-not-trigger) cases. Negative tests emphasize near-misses — scenarios that look similar to the skill's trigger but should activate a different skill instead.

### Division of labor

| Who | Writes | Graded by |
|-----|--------|-----------|
| Junior genealogists | JSON test files, scenarios, MCP fixtures via CRUD UI | LLM judge + human verification |
| Developers | Python pytest files | pytest (deterministic) |
| Senior genealogists | Skill rubrics, golden sets | Used as calibration baseline |

### What the test file contains

- Which skill is being tested
- The user message that triggers (or shouldn't trigger) the skill
- A reference to a project state scenario (created or selected by the genealogist)
- References to MCP tool response fixtures (created or selected by the genealogist)
- Plain English criteria describing correct behavior (LLM-judge-evaluated)

### What the test file does not contain

- Full inline project state (referenced by scenario name instead)
- Deterministic checks (those live in developer Python tests)
- Run results or grading output (those live in `eval/runlogs/`)
- MCP fixture data inline (referenced by file name)
- Lifecycle metadata (status, created_by, reviewed_by — tracked by the CRUD app, not the test file)

---

## 2. File Location and Naming

```
eval/tests/unit/<skill-name>/
  rubric.md                                    # skill-specific grading dimensions
  birthplace-ireland-vs-pennsylvania.json      # genealogist test (positive)
  concordant-sources-no-conflict.json          # genealogist test (positive)
  search-request-not-extraction.json           # genealogist test (negative)
```

Genealogist test files are named with a short kebab-case slug describing the scenario. The directory contains only files genealogists authored or need to see — no Python code.

Developer validators live separately:

```
eval/harness/validators/
  test_conflict_resolution.py
  test_record_extraction.py
  test_search_records.py
  ...
```

One file per skill, following pytest naming conventions.

---

## 3. Fixtures

### 3.1 Scenarios

Scenario fixtures provide the starting project state for a test. Each scenario is a directory containing:

```
eval/fixtures/scenarios/<scenario-name>/
  research.json        # Starting research.json state
  tree.gedcomx.json    # Starting tree.gedcomx.json state
  README.md            # Human-readable description for the UI dropdown
```

Both JSON files must conform to their respective schemas (`docs/specs/research-schema-spec.md` and `docs/specs/simplified-gedcomx-spec.md`).

**How scenarios reach Claude:** The harness creates a temp directory per test, copies scenario files into it, and sets it as the `cwd` for the Claude Agent SDK session. Skills read `research.json` and `tree.gedcomx.json` with the `Read` tool exactly as they do in Cowork — no mocking of file I/O. See Section 15 for full details.

The README.md describes the scenario in terms genealogists understand:

```markdown
# mid-research-flynn

Patrick Flynn parentage research, mid-project. Two questions active (parentage
and migration), 1850 census searched. Thomas Flynn identified as candidate father
from census co-residence. 5 assertions, 2 sources, no conflicts yet.
```

**Ownership:** Junior genealogists own scenario creation. The target state is a CRUD UI that provides form fields for building the research state (adding assertions, sources, plans, etc.) and generates the JSON behind the scenes. Genealogists understand the genealogy — what assertions exist, what sources were consulted, what conflicts are unresolved — and the UI translates that knowledge into valid `research.json` and `tree.gedcomx.json`.

**Phased rollout:** Building the scenario creation UI is a significant engineering effort (valid JSON with correct ID references, enum values, and cross-file consistency). In Phase 1, scenarios are created by devs + AI assistance. Juniors select from pre-built scenarios and describe gaps in `scenario_notes`. The full scenario creation UI is a Phase 2 capability.

Scenarios are reusable. When a junior creates a new scenario (or a dev creates one on their behalf), other juniors can select it from the dropdown for their tests. The README.md is auto-generated from the scenario contents.

**When to create a new scenario vs reuse:** If an existing scenario is close to what you need, select it and describe the differences in `scenario_notes`. If 3+ tests need the same modification, promote to a new named scenario.

### 3.2 MCP Fixtures

MCP fixtures provide mocked tool responses. Each fixture is a single JSON file:

```
eval/fixtures/mcp/<fixture-name>.json
```

Format:

```json
{
  "tool": "record_search",
  "description": "1860 census search for Flynn household in Schuylkill County PA",
  "response": {
    "...MCP tool response JSON..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | The MCP tool name this fixture applies to |
| `description` | string | Human-readable description for the UI dropdown |
| `response` | object | The exact JSON response the harness returns when this tool is called |

**Ownership:** Junior genealogists own fixture creation. The target state is a CRUD UI with two creation modes:

- **URL capture:** The genealogist pastes a record URL (e.g., a FamilySearch ARK). The UI calls the MCP tool against the live API, captures the response, and saves it as a fixture. The genealogist adds a description.
- **Manual entry:** For tools without URL-based lookup (e.g., `wikipedia_search`), the UI provides form fields for the response shape. The genealogist fills in the fields they understand (title, content summary) and the UI generates valid fixture JSON.

**Phased rollout:** URL capture requires calling live APIs from the UI (auth, error handling, response validation). In Phase 1, devs create fixtures by running tools against the live API and saving responses. The `--capture` flag on the harness supports this. Juniors select from pre-built fixtures and describe needs in `scenario_notes`. The full fixture creation UI is a Phase 2 capability.

Fixtures are reusable. When a junior creates a new fixture (or a dev creates one on their behalf), other juniors can select it from the dropdown.

---

## 4. Genealogist Test Schema

### Positive test

```json
{
  "test": {
    "id": "string (unique, ut_ prefix)",
    "skill": "string (directory name under plugin/skills/)",
    "name": "string (short human-readable name)",
    "type": "positive",
    "description": "string (1-2 sentences: what this test verifies and why it matters)",
    "tags": ["string (freeform tags for filtering and grouping)"]
  },

  "input": {
    "user_message": "string (what the user types)",
    "scenario": "string or null (name of a scenario in eval/fixtures/scenarios/)",
    "scenario_notes": "string or null (how this test's state differs from the base scenario)"
  },

  "mcp_fixtures": ["string (fixture file names from eval/fixtures/mcp/)"],

  "additional_criteria": [
    "string (case-specific grading criterion beyond the skill rubric)"
  ]
}
```

### Negative test

```json
{
  "test": {
    "id": "string (unique, ut_ prefix)",
    "skill": "string (directory name under plugin/skills/)",
    "name": "string (short human-readable name)",
    "type": "negative",
    "description": "string (1-2 sentences: what this test verifies and why it matters)",
    "tags": ["string (freeform tags for filtering and grouping)"]
  },

  "input": {
    "user_message": "string (what the user types)",
    "scenario": "string or null",
    "scenario_notes": "string or null"
  },

  "negative": {
    "correct_skill": "string (skill that should handle this request instead)",
    "explanation": "string (why the tested skill should not activate)"
  },

  "additional_criteria": [
    "string (optional — criteria about how the skill should decline)"
  ]
}
```

### Field presence rules

| Field | Positive tests | Negative tests |
|-------|---------------|----------------|
| `test` | required | required |
| `input` | required | required |
| `mcp_fixtures` | optional (omit if skill uses no MCP tools) | optional (omit if not needed) |
| `additional_criteria` | required, may be empty array | required, may be empty array |
| `negative` | omit | required |

### JSON Schema

The CRUD app validates test files against this schema on save. The harness validates on load.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "unit-test.schema.json",
  "title": "GeneFun Unit Test",
  "description": "A skill-level evaluation test for the GeneFun genealogy research assistant.",
  "type": "object",
  "required": ["test", "input", "additional_criteria"],
  "properties": {
    "test": {
      "type": "object",
      "required": ["id", "skill", "name", "type", "description", "tags"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^ut_",
          "description": "Unique test ID. Auto-generated by the app from skill name + sequence."
        },
        "skill": {
          "type": "string",
          "description": "Directory name under plugin/skills/. Must match an existing skill."
        },
        "name": {
          "type": "string",
          "description": "Short human-readable name shown in the test list view."
        },
        "type": {
          "type": "string",
          "enum": ["positive", "negative"],
          "description": "Positive: skill should activate. Negative: skill should decline."
        },
        "description": {
          "type": "string",
          "description": "1-2 sentences explaining what this test verifies and why it matters."
        },
        "tags": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Freeform tags for filtering and grouping. May be empty."
        }
      },
      "additionalProperties": false
    },
    "input": {
      "type": "object",
      "required": ["user_message"],
      "properties": {
        "user_message": {
          "type": "string",
          "description": "The exact user input fed to the test harness."
        },
        "scenario": {
          "type": ["string", "null"],
          "description": "Name of a scenario directory under eval/fixtures/scenarios/. Null for stateless skills."
        },
        "scenario_notes": {
          "type": ["string", "null"],
          "description": "Documentation only — harness ignores this. Describes how the required state differs from the selected scenario."
        }
      },
      "additionalProperties": false
    },
    "mcp_fixtures": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Fixture file names (without path or extension) from eval/fixtures/mcp/. Optional for both positive and negative tests."
    },
    "additional_criteria": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Case-specific grading criteria beyond the skill rubric. May be empty."
    },
    "negative": {
      "type": "object",
      "required": ["correct_skill", "explanation"],
      "properties": {
        "correct_skill": {
          "type": "string",
          "description": "The skill that should handle this request instead. Must be a valid skill directory name."
        },
        "explanation": {
          "type": "string",
          "description": "Why the tested skill should not activate. Documents the boundary between the two skills."
        }
      },
      "additionalProperties": false
    }
  },
  "allOf": [
    {
      "if": {
        "properties": { "test": { "properties": { "type": { "const": "positive" } } } }
      },
      "then": {
        "not": { "required": ["negative"] }
      }
    },
    {
      "if": {
        "properties": { "test": { "properties": { "type": { "const": "negative" } } } }
      },
      "then": {
        "required": ["negative"]
      }
    }
  ],
  "additionalProperties": false
}
```

---

## 5. Field Details

### 5.1 `test`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique test ID with `ut_` prefix (e.g., `ut_record_extraction_001`). Auto-generated by the app from skill name + sequence |
| `skill` | string | yes | Must match a directory name under `plugin/skills/`. Set by skill dropdown in the UI |
| `name` | string | yes | Short human-readable name shown in the test list view |
| `type` | string | yes | `"positive"` or `"negative"`. Determines which other fields are present |
| `description` | string | yes | 1-2 sentences explaining what this test verifies and why it matters |
| `tags` | string[] | yes | Freeform tags for filtering and grouping. May be empty. The UI uses these for filtering the test list. Useful tag dimensions: record type (`census`, `vital-record`, `probate`), time period (`1850`, `1860`), GPS concept (`informant-weighting`, `independence`, `negative-evidence`), test pattern (`near-miss`, `multi-person`, `stateless`) |

### 5.2 `input`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_message` | string | yes | The exact user input fed to the test harness. For positive tests, this should trigger the skill. For negative tests, this should look like it might trigger the skill but shouldn't. **Known limitation:** this assumes single-turn interaction. Multi-turn skills (e.g., `search-external-sites`, which generates a URL then waits for a user to paste back a capture) are not supported in v1 |
| `scenario` | string or null | no | Name of a shared scenario directory under `eval/fixtures/scenarios/`. The harness loads the scenario's `research.json` and `tree.gedcomx.json` as the starting project state. Null or omitted for stateless skills (wiki-lookup, translation, historical-context, locality-guide, convert-dates) |
| `scenario_notes` | string or null | no | Documentation only — the harness ignores this field. Describes how the test's required state differs from the selected scenario. The scenario must already contain the exact required state for the test to be runnable. When a junior can't find an exact scenario, they pick the closest one and describe the gap here, then either create a new scenario that matches or wait for one to be created. If the same notes appear in 3+ tests, promote to a new named scenario |

### 5.3 `mcp_fixtures`

Array of fixture file names (without path or extension) from `eval/fixtures/mcp/`. Each name references a JSON file containing a mocked MCP tool response. The harness intercepts MCP tool calls during the test and returns the corresponding fixture.

Only present for skills that call MCP tools. Omit entirely for skills with no `allowed-tools` in their SKILL.md frontmatter.

The CRUD UI presents a dropdown of available fixtures for skills that need them.

**Multi-call handling:** If `mcp_fixtures` lists multiple files for the same tool, the harness returns them in order for successive calls. If only one fixture exists for a tool that's called multiple times, the same response is returned each time.

### 5.4 `additional_criteria`

Array of plain English strings. Each criterion describes a case-specific aspect of correct behavior that goes beyond the skill rubric. The LLM judge evaluates these alongside the skill rubric dimensions.

The skill rubric (Section 7) covers general quality standards that apply to every test for that skill. `additional_criteria` captures things unique to this specific scenario that the rubric doesn't cover. The CRUD UI displays the skill's rubric dimensions so genealogists know what's already covered and can focus on what's specific to their test case.

A test with zero additional criteria is still graded on the base rubric (2 dimensions) + skill rubric (3-5 dimensions). This means a junior genealogist can create a useful test even if they only fill in the test metadata and user message — the rubric carries the primary grading weight.

Guidelines for writing additional criteria:

- **Focus on what's unique to this scenario.** Don't restate what the skill rubric already covers. If the rubric says "extraction completeness," don't add "should extract all facts." Instead add criteria about *this specific record's* unusual characteristics.
- **Be specific.** "Should extract assertions" is too vague. "Should extract assertions for at least 3 persons (head of household, wife, and Patrick)" is testable.
- **Include reasoning.** "Should classify 'son' as primary information with direct evidence — the 1860 census states relationships explicitly unlike 1850" tells the judge *why* the classification is correct.
- **State negatives when important.** "Should NOT call any MCP search tools — the record is already in context" catches a specific failure mode.

### 5.5 `negative`

Only present when `test.type` is `"negative"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `correct_skill` | string | yes | The skill that should handle this request instead. Must be a valid skill directory name |
| `explanation` | string | yes | Why the tested skill should not activate. Documents the boundary between the two skills so reviewers (and the description optimizer) understand the discrimination |

---

## 6. Negative Tests

Negative tests verify that a skill does NOT activate for requests that should be handled by a different skill. They are critical for the description optimizer, which uses should-trigger / should-not-trigger test sets to improve skill descriptions.

### Boundary testing pattern

Every skill's SKILL.md has "Do NOT use when" clauses that name confusable skills. These are natural sources of negative tests:

| Skill tested | Confusable skill | Boundary signal |
|-------------|-----------------|-----------------|
| record-extraction | search-records | "search for" vs "analyze this record" |
| search-records | record-extraction | record data in context vs not |
| question-selection | research-plan | "what question next" vs "how to answer this question" |
| conflict-resolution | assertion-classification | conflicting facts vs classifying evidence type |
| proof-conclusion | project-status | "write the proof" vs "where are we" |

For each confusable pair, create tests from both directions: a test in skill A's directory with `correct_skill: "B"`, and a corresponding test in skill B's directory with `correct_skill: "A"`.

### Grading negative tests

**Activation** means the skill produced substantive output — file writes or a response that performs the skill's workflow. A skill that starts but then says "this isn't my job, try search-records instead" has *not* activated; it has correctly declined.

1. **Did the skill activate?** If yes (substantive output), the test fails. If no (declined or suggested an alternative), the test passes.
2. **Did the skill suggest the correct alternative?** Evaluated by LLM judge against `negative.correct_skill`. Partial credit if the skill correctly declined but suggested the wrong alternative.
3. **Additional criteria** (if present): evaluated by LLM judge. Example: "Should explicitly tell the user this looks like a search request" or "Should NOT partially execute before declining."

---

## 7. Grading

### What the skill produces

When a test runs, the skill produces three things:

1. **Text output** — what Claude said to the user (reasoning, explanations, instructions)
2. **File changes** — modifications to research.json and/or tree.gedcomx.json
3. **Tool calls** — which MCP tools were called, with what arguments

Grading evaluates all three.

### Grading layers

Three independent layers. Each feeds results into the run log. The layers do not see each other's results — this prevents cascading bias (e.g., a schema violation from Layer 1 shouldn't drag down every quality score in Layer 2).

| Layer | What | Model | Sees | Output |
|-------|------|-------|------|--------|
| Layer 1: Deterministic | Structural correctness | Python (no LLM) | Full before/after state + tool calls | Binary pass/fail per check |
| Layer 2: LLM judge | Quality evaluation | Haiku | Scenario README + diffs + text + tool calls + rubric + criteria | Score + rationale per dimension |
| Layer 3: Human | Verification | Junior + senior genealogists | Both Layer 1 and Layer 2 results | Agree/disagree per dimension |

**Cost optimization:** If Layer 1 validators fail, skip Layer 2 (the LLM judge). The test already failed structurally — don't spend money evaluating quality of broken output.

### Layer 1: Deterministic validators

See Section 8 for details. Validators check structural correctness at two scopes:

**Universal validators (all skills):**
- Schema validity of the final output files
- ID integrity (all referenced IDs exist)
- ID format (correct prefixes)
- Append-only enforcement (log entries not modified)
- No-delete enforcement (entries superseded, not removed)
- Enum validation

**Skill-specific validators (per skill):**
- Ownership enforcement — the skill only wrote to sections it owns
- Tool allowlist — the skill only called tools listed in its `allowed-tools` frontmatter

Validators operate on the full before/after state and compute the diff internally.

**Test-specific structural assertions** (e.g., "should add exactly 5 assertions") are handled by the LLM judge, not deterministic validators. The judge is good enough at evaluating structural claims from plain English criteria. The human review layer catches cases where the judge miscounts. Deterministic validators focus on things LLMs are bad at (schema conformance, ID referential integrity, ownership tables).

### Layer 2: LLM judge

The judge evaluates quality using a three-tier rubric:

| Tier | Defined where | Applies to | Who maintains |
|------|--------------|------------|---------------|
| Base rubric | Shared across all skills | Every unit test | Developers |
| Skill rubric | `eval/tests/unit/<skill>/rubric.md` | Every test for one skill | Senior genealogists |
| Per-test criteria | `additional_criteria` in test JSON | One test only | Junior genealogists |

**Base rubric** — two dimensions that apply to every skill:

| Dimension | What the judge evaluates |
|-----------|------------------------|
| Correctness | Are the skill's outputs factually correct given the input state? Are claims supported by the provided sources and assertions? |
| Completeness | Did the skill address everything the input state and user message required? Were there omissions? |

**Skill rubrics** — each skill gets a `rubric.md` defining 3-5 domain-specific dimensions. Cap at 5 per skill (plus 2 base = 7 total). Each rubric is self-contained. Examples:

- conflict-resolution: source independence analysis, evidence weighing, resolution completeness
- record-extraction: assertion atomicity, informant identification, evidence type accuracy
- citation: Evidence Explained compliance, replication test, source vs information distinction

**How the tiers interact:** A test for record-extraction with 2 additional criteria is graded on 2 base + 3 skill + 2 additional = 7 total dimensions. A test with 0 additional criteria is still graded on 5 dimensions — the rubric carries the primary grading weight.

**Judge prompt inputs:**

| Input | What | Why |
|-------|------|-----|
| Scenario README | 3-5 line summary of research state | Context without sending 700+ lines of JSON |
| User message | What the user asked | The task the skill was supposed to accomplish |
| Claude's full text response | Everything Claude said | Evaluate reasoning quality, not just file changes |
| research.json diff | Entries added/modified | The structural output to evaluate |
| tree.gedcomx.json diff | Entries added/modified | GedcomX changes to evaluate |
| MCP tool calls | Tool name, arguments, responses | Tool usage quality evaluation |
| Skill rubric | 3-5 dimensions | What to grade on |
| Additional criteria | 0-N plain English strings | Test-specific expectations |

**What the judge does NOT see:** Deterministic validator results. The layers are independent. A schema violation is already captured in Layer 1 — showing it to the judge would bias every quality score downward, double-penalizing structural failures.

### Layer 3: Human verification

Juniors annotate the LLM judge's scores (agree/disagree per dimension). Seniors adjudicate when annotations disagree. See `eval/CLAUDE.md` for annotation/adjudication file conventions.

---

## 8. Deterministic Validators

Validators provide structural correctness checks. They run automatically after each test execution, before the LLM judge. If any validator fails, the LLM judge is skipped (saves cost — the test already failed structurally).

Validator results (pass/fail per check) are included in the run log and visible in the CRUD UI. Juniors see validator failures immediately.

### Validator inputs

The harness provides validators with:
- The scenario files (before state)
- The output files (after state)
- The list of MCP tool calls made (tool name, arguments, responses)

Validators compute the diff internally from before/after state.

### Universal validators (all skills)

Shared validation code in `eval/harness/validators/`. These run on every test regardless of skill.

- **Schema validation** — required fields, types, enum values in the final output files. Operates on the full output.
- **ID integrity** — all referenced IDs exist in the final state (`source_id` points to a real source, `person_id` points to a real GedcomX person). Operates on the full output.
- **ID format** — new entries use correct prefixes (`a_`, `c_`, `src_`, `pe_`, etc.). Operates on the diff.
- **Append-only enforcement** — existing log entries were not modified or deleted. Operates on the diff.
- **No-delete enforcement** — no entries were removed from any section. Operates on the diff.
- **Enum validation** — all enum fields use values from research-schema-spec.md Section 2. Operates on the full output.

### Skill-specific validators (per skill)

One file per skill in `eval/harness/validators/`, following pytest naming (`test_conflict_resolution.py`).

- **Ownership enforcement** — the skill only wrote to sections it owns per the ownership table in research-schema-spec.md Section 4. Operates on the diff.
- **Tool allowlist** — the skill only called MCP tools listed in its SKILL.md `allowed-tools` frontmatter. Operates on the tool calls list.
- **Skill structural rules** — requirements from SKILL.md that are deterministically checkable (e.g., "every conflict must have ≥2 competing_assertion_ids"). Operates on the diff.

### Conventions

- Files follow pytest naming: `test_*.py`
- Universal validators live in `eval/harness/validators/`
- Skill-specific validators live in `eval/harness/validators/`, one file per skill
- Use `@pytest.mark.slow` for tests that make real API calls
- Fast tests (default) validate output structurally — no API calls, no LLM calls
- Slow tests verify that MCP fixtures are still valid (API response shapes haven't changed)

The exact API for validators is not prescribed — developers will discover the right patterns when writing the first tests. The `research-schema-spec.md` ownership table is the source of truth for structural invariants.

---

## 9. Test Authoring Workflow

### Phase 1 workflow (launch)

In Phase 1, juniors select from pre-built scenarios and fixtures created by devs + AI assistance. Juniors own test creation; devs own scenario and fixture creation.

**Step 1: Junior genealogist creates the test**

Using the CRUD UI, the junior:

1. Selects a skill from the dropdown
2. Writes a name, description, and tags
3. Chooses positive or negative type
4. Selects a scenario from the dropdown (if the skill needs project state)
   - If no scenario matches, picks the closest one and describes the gap in `scenario_notes`. A dev creates a new scenario.
5. Selects MCP fixtures from the dropdown (if the skill uses MCP tools)
   - If no fixture matches, describes the needed response in `scenario_notes`. A dev creates the fixture.
6. Writes the user message
7. For positive tests: writes additional criteria as plain English sentences (the UI shows the skill's rubric dimensions so the genealogist knows what's already covered)
8. For negative tests: selects the correct skill and writes the boundary explanation

Tests with matching scenarios are immediately runnable. Tests with `scenario_notes` describing missing state are not runnable until a dev creates the scenario/fixture.

### Phase 2 workflow (target)

In Phase 2, the CRUD UI supports scenario and fixture creation directly. Juniors create complete, runnable tests without developer assistance:

- **Scenarios:** the UI provides form fields for building research state (assertions, sources, plans, etc.) and generates valid JSON behind the scenes.
- **MCP fixtures:** the UI supports URL capture (paste a record URL, capture the live API response) and manual entry (form fields for response shape).

### Step 2: Senior genealogist reviews

The senior:

1. Reviews the additional criteria for genealogical accuracy
2. Verifies negative test boundaries are correct
3. Checks that the scenario is realistic and the fixtures are appropriate
4. Approves or sends back with comments

### Step 3: Dev reviews (periodic)

Devs periodically review the test corpus for structural quality:

1. Verifies scenarios produce valid JSON conforming to the research schema
2. Verifies MCP fixtures match current API response shapes
3. Writes or updates Python validators for the skill
4. Flags tests that need scenario or fixture corrections

### AI-assisted bulk authoring

For initial test creation, an LLM can generate draft tests from a skill's SKILL.md. The LLM reads the skill's "Use when," "Do NOT use when," and workflow description, then generates a set of positive and negative test cases. A junior genealogist reviews and refines the criteria. This bootstraps the 30+ tests per skill faster than manual authoring.

---

## 10. Run Log Format

When the harness executes a unit test, it writes a run log to:

```
eval/runlogs/unit/<skill-name>/<model-version>/YYYY-MM-DD-HH-MM-SS.json
```

Including the model version in the path makes it easy to compare runs across model versions.

The run log contains:
- Test ID, skill name, and timestamp
- Model version used
- Scenario and fixtures used
- The skill's raw output (Claude's response text + any file writes)
- Layer 1 deterministic test results (pass/fail per check)
- Layer 2 LLM judge scores (per criterion + per rubric dimension)
- MCP tool calls made (tool name, arguments, fixture matched)
- Token usage and API cost
- Wall-clock duration

Annotations and adjudications use the naming convention from `eval/CLAUDE.md`:
```
YYYY-MM-DD-HH-MM-SS.ann.<github-username>.json    # junior annotation
YYYY-MM-DD-HH-MM-SS.adj.<github-username>.json    # senior adjudication
```

Schema TBD — will be defined when the harness is built.

---

## 11. Cost

### Model selection

| Role | Model | Rationale |
|------|-------|-----------|
| Skill execution | Sonnet (pinned version) | Matches what Cowork uses. Needed for genealogical reasoning. |
| LLM judge | Haiku | Grading against a structured rubric is a classification task, not a reasoning task. ~20x cheaper than Sonnet. Upgrade selectively if specific dimensions prove unreliable. |

**Alternative judge model:** Gemini 2.5 Flash (~$0.15/1M input, $0.60/1M output) is ~5x cheaper than Haiku for the judge role. If Google APIs are already in use, Flash is a viable option that reduces judge cost from ~$0.01 per test to ~$0.002. The harness should support configurable judge model selection so the cheapest adequate model can be used.

### Cost optimizations

1. **Cheap judge model.** The biggest cost lever. Using Haiku instead of Sonnet for the judge cuts judge cost ~20x. Gemini Flash cuts it ~100x.

2. **Prompt caching for batched skill runs.** When running 15 tests for one skill, the SKILL.md + references (~5-10K tokens) is identical across all tests. With prompt caching, cached input tokens cost 90% less. The harness structures prompts so cacheable content (skill prompt) comes first and test-specific content (scenario state, user message) comes last.

3. **Skip the judge when validators fail.** If deterministic validators catch a schema violation or ownership breach, skip the LLM judge. The test already failed — don't pay for quality evaluation of broken output.

4. **Trim scenario input to relevant sections.** The research schema ownership table defines which sections each skill reads. The harness sends only those sections, not the full research.json. For conflict-resolution (reads assertions, person_evidence, conflicts, sources), this cuts input tokens by 30-60% compared to sending the full file.

### Estimated costs

Costs assume prompt caching and input trimming. Most tests are mid-complexity (~$0.10-0.20 per test). Simple stateless skills (wiki-lookup, convert-dates) are at the low end (~$0.03). Complex synthesis skills (proof-conclusion, research-plan) are at the high end (~$0.40).

| Scope | Estimated cost |
|-------|---------------|
| Single test | $0.03-0.40 |
| One skill (10-20 tests) | $1.50-3 |
| Full suite (230-460 tests) | $35-70 |

Affordable for iterative development. Run individual skill suites during active development. Run the full suite on PR branches, not on every local save.

---

## 12. Test Volume

Target: **10-20 tests per skill**, split roughly 50/50 between positive and negative:

- 5-10 positive tests covering the skill's main use cases
- 5-10 negative tests covering confusable-skill boundaries

With 23 skills, the target is **230-460 tests total**. This is enough to catch regressions, feed the description optimizer, and give the LLM judge meaningful signal. More tests per skill yields diminishing returns — the 15th conflict-resolution test teaches less than the 5th.

Junior genealogists create tests via the CRUD UI. Senior genealogists review a subset as golden sets for calibration.

---

## 13. Worked Examples

### 13.1 Positive test: record-extraction

```json
{
  "test": {
    "id": "ut_record_extraction_001",
    "skill": "record-extraction",
    "name": "1860 census multi-person household extraction",
    "type": "positive",
    "description": "Tests extraction from a multi-person census record where the 1860 format explicitly states relationships, unlike the 1850 census.",
    "tags": ["census", "1860", "multi-person", "relationship-column"]
  },

  "input": {
    "user_message": "Analyze this census record and extract assertions.",
    "scenario": "flynn-1860-census-in-context"
  },

  "mcp_fixtures": ["1860-census-schuylkill-flynn"],

  "additional_criteria": [
    "Should classify the relationship 'son' as primary information with direct evidence — the 1860 census states relationships explicitly, unlike the 1850 census",
    "Should distinguish the census enumerator (recorder) from the household member who likely provided information (informant)"
  ]
}
```

### 13.2 Negative test: record-extraction

```json
{
  "test": {
    "id": "ut_record_extraction_020",
    "skill": "record-extraction",
    "name": "Search request should not trigger extraction",
    "type": "negative",
    "description": "User asks to search for records. This should trigger search-records, not record-extraction.",
    "tags": ["near-miss", "search-boundary"]
  },

  "input": {
    "user_message": "Search for Patrick Flynn in the 1860 census for Schuylkill County",
    "scenario": "mid-research-flynn"
  },

  "negative": {
    "correct_skill": "search-records",
    "explanation": "The user wants to search for records they haven't found yet, not analyze a record already in context. 'Search for' is the key signal. There is no record data in Claude's context to extract from."
  },

  "additional_criteria": [
    "Should explicitly suggest search-records as the right tool for this request"
  ]
}
```

### 13.3 Positive test: wiki-lookup (stateless skill)

```json
{
  "test": {
    "id": "ut_wiki_lookup_001",
    "skill": "wiki-lookup",
    "name": "Simple topic lookup",
    "type": "positive",
    "description": "Basic Wikipedia lookup for a genealogically relevant topic.",
    "tags": ["wikipedia", "simple"]
  },

  "input": {
    "user_message": "Look up Schuylkill County, Pennsylvania on Wikipedia",
    "scenario": null
  },

  "mcp_fixtures": ["wikipedia-schuylkill-county"],

  "additional_criteria": [
    "Should save the summary to a file in the user's working folder, not just display it"
  ]
}
```

### 13.4 Positive test: conflict-resolution (identity resolution skill)

```json
{
  "test": {
    "id": "ut_conflict_resolution_001",
    "skill": "conflict-resolution",
    "name": "Resolve birthplace conflict via informant proximity",
    "type": "positive",
    "description": "Three sources disagree on birthplace. Two contemporary census records say Ireland, one later death certificate says Pennsylvania. Tests whether the skill weighs informant proximity and temporal distance correctly.",
    "tags": ["birthplace", "informant-weighting", "census-vs-vital"]
  },

  "input": {
    "user_message": "Check for conflicts in Patrick Flynn's evidence.",
    "scenario": "flynn-with-birthplace-conflict"
  },

  "additional_criteria": [
    "Should note that the two census informants may be the same household member, weakening their independence for this specific fact",
    "Resolution should cite both informant proximity (household_member vs family_not_present) and temporal distance (contemporary vs 63 years later) as factors"
  ]
}
```

### 13.5 Positive test with scenario_notes: research-plan (Phase 1 workflow)

This example shows the Phase 1 pattern: the junior picks the closest scenario but no exact match exists. The test is not runnable until a dev creates a matching scenario.

```json
{
  "test": {
    "id": "ut_research_plan_003",
    "skill": "research-plan",
    "name": "Plan should include probate records as fallback",
    "type": "positive",
    "description": "When census searches have been completed, the plan should suggest probate records as a follow-up source for parentage evidence.",
    "tags": ["probate", "fallback", "parentage"]
  },

  "input": {
    "user_message": "Create a research plan for the next question.",
    "scenario": "mid-research-flynn",
    "scenario_notes": "Need a variant where q_001 (parentage) has exhausted census searches (1850 and 1860 completed in the log) but probate has not been searched yet. The current mid-research-flynn scenario only has the 1850 search completed."
  },

  "additional_criteria": [
    "Plan should include probate records for Schuylkill County as a plan item",
    "Probate item rationale should explain that a will naming Patrick as son would provide direct evidence of parentage"
  ]
}
```

When a dev reads `scenario_notes`, they create a new scenario (e.g., `flynn-census-exhausted`) that has both census searches in the log. The junior then updates the test to its final runnable form:

```json
  "input": {
    "user_message": "Create a research plan for the next question.",
    "scenario": "flynn-census-exhausted"
  },
```

### 13.6 Positive test: question-selection (planning skill)

```json
{
  "test": {
    "id": "ut_question_selection_005",
    "skill": "question-selection",
    "name": "Prioritize unresolved conflict over timeline gap",
    "type": "positive",
    "description": "When an unresolved conflict exists alongside a timeline gap, the skill should prioritize resolving the conflict.",
    "tags": ["prioritization", "conflict-vs-gap"]
  },

  "input": {
    "user_message": "What should I research next?",
    "scenario": "flynn-conflict-and-gap"
  },

  "additional_criteria": [
    "Should prioritize the conflict over the gap — conflicts affect the reliability of existing conclusions",
    "Should formulate a specific research question targeting the conflict (e.g., 'What is Patrick Flynn's birthplace?'), not a generic 'resolve the conflict'"
  ]
}
```

---

## 14. Relationship to E2E Tests

Unit tests and e2e tests are complementary (see `e2e-test-format-spec.md`):

- **Unit tests** test skills in isolation with mocked MCP responses. Cheap, fast, reproducible. Use for iterative skill improvement (Phases 1-3).
- **E2e tests** test the full pipeline with live API calls. Expensive, slow, subject to API variance. Use for validation after skills are performing well (Phase 4).

### Shared conventions

| Convention | Unit tests | E2e tests |
|-----------|-----------|-----------|
| ID prefix | `ut_` | `e2e_` |
| Location | `eval/tests/unit/` | `eval/tests/e2e/` |
| Run logs | `eval/runlogs/unit/<skill>/<model>/<timestamp>.json` | `eval/runlogs/e2e/<slug>/<model>/<timestamp>.json` |
| Annotations | `.ann.<username>.json` | `.ann.<username>.json` |
| Adjudications | `.adj.<username>.json` | `.adj.<username>.json` |
| MCP data | Mocked via fixtures | Live API calls |
| Grading layers | Deterministic + LLM judge + human | Deterministic + LLM judge + human |

Skill rubric dimensions should align with the e2e base rubric dimensions where they overlap. For example, the conflict-resolution skill rubric's "evidence weighing" dimension corresponds to the e2e base rubric's "conflict handling" dimension. This ensures unit test improvements translate to e2e improvements.

---

## 15. Harness Implementation

### Temp directory per test

Each test runs in an isolated temp directory. The harness copies scenario files and the skill being tested into it, then sets it as `cwd` for the Claude Agent SDK session. This reproduces how Cowork presents project files to skills — skills use `Read`, `Write`, and `Edit` tools on real files in the working directory.

```
/tmp/eval-<test-id>-<random>/
  research.json              ← copied from eval/fixtures/scenarios/<scenario>/
  tree.gedcomx.json          ← copied from eval/fixtures/scenarios/<scenario>/
  .claude/
    skills/
      <skill-name>/          ← copied from plugin/skills/<skill-name>/
        SKILL.md
        references/          (if present)
        templates/           (if present)
        scripts/             (if present)
```

For stateless tests (`scenario: null`), the temp directory contains only `.claude/skills/`. For `init-project` tests, the directory starts without `research.json` or `tree.gedcomx.json` — the skill creates them.

### Why copy the skill, not symlink

Each skill is self-contained (no cross-skill file references). Copying avoids symlink management, works across platforms, and ensures full isolation when tests run in parallel. Skill directories are small (16-76K) so copy cost is negligible.

### Claude Agent SDK configuration

```python
from claude_code_sdk import query, ClaudeAgentOptions

options = ClaudeAgentOptions(
    cwd=tmp_dir,
    setting_sources=["user", "project"],
    allowed_tools=["Read", "Write", "Edit", "Skill", "Glob", "Grep"],
    model="claude-sonnet-4-6-20250514",  # pinned model version
)

async for message in query(prompt=user_message, options=options):
    # collect results
```

Key settings:
- `cwd` — the temp directory. The SDK discovers skills from `.claude/skills/` relative to this path.
- `setting_sources=["user", "project"]` — required for skill discovery. `"project"` loads `.claude/` from cwd.
- `allowed_tools` — pre-approve the tools skills need so they don't require interactive permission.
- `model` — pinned to a specific version for reproducibility across runs.

### MCP fixture injection via mock server

The harness runs a lightweight mock MCP server that returns fixture data instead of calling live APIs. This uses the standard MCP protocol (JSON-RPC over stdio) — the skill sees a real tool response through the normal channel, identical to production behavior.

The mock server lives in `eval/harness/mock_mcp_server.py` and is started as a subprocess per test.

```python
# mock_mcp_server.py (simplified)
class MockMCPServer:
    def __init__(self, fixture_manifest):
        # fixture_manifest: {tool_name: [response1, response2, ...]}
        self.queues = fixture_manifest
        self.call_log = []  # captures tool calls for run log

    def handle_call(self, tool_name, arguments):
        self.call_log.append({"tool": tool_name, "args": arguments})
        queue = self.queues.get(tool_name, [])
        if not queue:
            return {"error": f"No fixture for tool {tool_name}"}
        if len(queue) == 1:
            return queue[0]       # reuse single fixture for repeated calls
        return queue.pop(0)       # consume next in order for multi-call
```

The harness builds the fixture manifest from the test's `mcp_fixtures` array:

```python
def build_fixture_manifest(fixture_names, fixtures_dir):
    manifest = {}
    for name in fixture_names:
        fixture = json.load(open(fixtures_dir / f"{name}.json"))
        tool = fixture["tool"]
        manifest.setdefault(tool, []).append(fixture["response"])
    return manifest
```

The SDK is configured to use the mock server instead of the real MCP server:

```python
options = ClaudeAgentOptions(
    cwd=tmp_dir,
    mcp_servers={
        "familysearch": {
            "command": "python",
            "args": [str(mock_server_path), "--manifest", str(manifest_path)],
            "transport": "stdio",
        }
    },
    # ...
)
```

**Multi-call handling:** If `mcp_fixtures` lists multiple fixture files for the same tool (same `tool` field), the mock server queues them and returns them in order for successive calls. If only one fixture exists for a tool called multiple times, the same response is returned each time.

**Tool call capture:** The mock server logs every tool call (tool name + arguments + response returned). After the test completes, the harness reads this log for the run log and for the LLM judge's tool usage evaluation.

**Why a mock server, not hooks:** PreToolUse/PostToolUse hooks depend on undocumented behavior for response substitution. A mock MCP server uses the standard MCP protocol — the skill sees a real tool response through the normal channel. No hook API stability risk.

### Parallel execution

Tests are independent — each has its own temp directory, its own mock MCP server subprocess, and its own SDK session. Run them concurrently with `asyncio.gather`:

```python
async def run_all_tests(tests):
    tasks = [run_single_test(t) for t in tests]
    results = await asyncio.gather(*tasks, return_exceptions=True)
```

Each test starts and stops its own mock server subprocess. No shared state, no conflicts.

**Session storage caveat:** The SDK stores sessions under `~/.claude/projects/<encoded-cwd>/`. With temp directories, each test creates a new session path that's never reused. The harness should clean up `~/.claude/projects/` entries after each test, or disable session persistence if the SDK supports it.

### Output capture

The harness captures all three skill outputs:

1. **Text output** — Claude's full response text (reasoning, explanations). Collected from the `query()` message stream.
2. **File changes** — the harness snapshots all files in the temp directory before and after the skill runs, then computes the diff.
3. **Tool calls** — which MCP tools were called, with what arguments and responses. Captured from the hook intercepts.

```python
pre_state = snapshot_json_files(tmp_dir)   # {filename: parsed_json}
# ... run skill, collect text_output and tool_calls ...
post_state = snapshot_json_files(tmp_dir)
diff = compute_diff(pre_state, post_state)  # what changed, what was created
```

For stateless skills that write new files (wiki-lookup saves a markdown file, init-project creates research.json), the harness detects newly created files in the temp directory.

### Input trimming

The research schema ownership table (Section 4) defines which sections each skill reads. The harness uses this to copy only the relevant sections from the scenario's research.json into the temp directory, reducing input tokens by 30-60% for complex scenarios.

For example, conflict-resolution reads `assertions`, `person_evidence`, `conflicts`, and `sources`. The harness writes a research.json containing only those sections (plus `project` for context), with empty arrays for the rest. This saves tokens without affecting skill behavior — the skill would find empty arrays anyway in sections it doesn't read.

The mapping of skill → read sections is derived from the ownership table and hardcoded in the harness configuration. If a skill's read dependencies change, the harness config must be updated.

### Prompt caching

When running a batch of tests for one skill (e.g., 30 conflict-resolution tests), the skill prompt (SKILL.md + references/) is identical across all tests. The harness structures the SDK prompt so cacheable content comes first:

```
[CACHEABLE — same across all tests for this skill]
System prompt + SKILL.md + references/ + templates/

[VARIES PER TEST]
Scenario state (research.json sections)
User message
```

With prompt caching, the cached portion costs 90% less on subsequent tests in the batch. The harness should run tests for the same skill consecutively (not interleaved with other skills) to maximize cache hits.

The same caching strategy applies to the LLM judge — the judge system prompt + skill rubric is identical across all tests for a skill.

### Grading pipeline

After the skill executes and output is captured:

```
1. Run deterministic validators (before/after state + tool calls)
     ↓
   Any validator failures?
     → Yes: skip LLM judge, record failures in run log
     → No: continue
     ↓
2. Run LLM judge (Haiku)
   Inputs: scenario README, user message, text output, diffs, tool calls, rubric, criteria
   Output: score + rationale per dimension
     ↓
3. Write run log to eval/runlogs/unit/<skill>/<model>/<timestamp>.json
   Contains: all three outputs + validator results + judge scores
```

### Known risks

- **Skill discovery on Linux:** The testing plan flags issue #268 — hardcoded macOS paths in the SDK's skill discovery. Verify that `.claude/skills/<name>/SKILL.md` is found correctly on Linux before trusting results.
- **Session storage pollution:** Temp directories create orphaned session entries in `~/.claude/projects/`. The harness must clean these up or the directory will grow unboundedly.
- **`allowed_tools` scope:** `allowed_tools` pre-approves tools but does not restrict. A skill could call tools not in the list (it would just prompt for permission, which the harness can't answer). Consider using `disallowed_tools` to block tools that should never be called during testing (e.g., `Bash` for pure analysis skills).
- **Hook API stability:** The PreToolUse hook interface may change between SDK versions. Pin the SDK version in `eval/harness/pyproject.toml`.

---

## 16. Reference Examples

The following seed files exist in the repo as working references for harness development. Each category has at least one example demonstrating the expected format and conventions.

### Scenarios

| Scenario | Path | Description |
|----------|------|-------------|
| `mid-research-flynn` | `eval/fixtures/scenarios/mid-research-flynn/` | Base Patrick Flynn research state. 13 assertions, 4 sources, 1 resolved conflict, 1 supported hypothesis. Used by most skill tests. |
| `flynn-with-birthplace-conflict` | `eval/fixtures/scenarios/flynn-with-birthplace-conflict/` | Same as above but birthplace conflict is unresolved (status: "unresolved", null analysis fields). Used by conflict-resolution tests. |

Each scenario directory contains `research.json`, `tree.gedcomx.json`, and `README.md`.

### MCP Fixtures

Eight fixtures in `eval/fixtures/mcp/`:

| Fixture | Tool | Used by |
|---------|------|---------|
| `wikipedia-schuylkill-county.json` | `wikipedia_search` | wiki-lookup |
| `search-wiki-irish-immigration.json` | `search_wiki` | historical-context |
| `places-schuylkill-county.json` | `places` | locality-guide, research-plan, timeline |
| `record-search-1850-census-flynn.json` | `record_search` | search-records |
| `fulltext-search-flynn-witnesses.json` | `fulltext_search` | search-full-text |
| `external-links-schuylkill.json` | `external_links` | search-external-sites |
| `collections-schuylkill.json` | `collections` | locality-guide, research-plan |
| `person-read-flynn.json` | `person_read` | init-project |

### Unit Tests

23 seed tests (one per skill) in `eval/tests/unit/<skill>/`. Each skill directory also contains a `rubric.md`. Key examples:

| Test | Path | Pattern |
|------|------|---------|
| Positive with scenario | `eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json` | Skill reads scenario state, produces file changes |
| Positive stateless | `eval/tests/unit/wiki-lookup/simple-topic-lookup.json` | No scenario, uses MCP fixture |
| Positive with fixtures | `eval/tests/unit/search-records/execute-census-search.json` | Scenario + MCP fixture |

### Deterministic Validators

Two seed validators in `eval/harness/validators/`:

| Validator | Path | Scope |
|-----------|------|-------|
| Universal | `eval/harness/validators/test_universal.py` | All skills. Checks: schema structure, enum values, ID prefixes, ID referential integrity, append-only log, no-delete enforcement. |
| Conflict-resolution | `eval/harness/validators/test_conflict_resolution.py` | One skill. Checks: ownership enforcement (only writes to `conflicts`), no MCP tool calls, fact conflicts have ≥2 competing assertions, resolved conflicts have required fields, preferred assertion is in competing list. |

The universal validator demonstrates the pattern for general validators. The conflict-resolution validator demonstrates the pattern for skill-specific validators (ownership, tool allowlist, structural rules from SKILL.md). Use these as templates when writing validators for other skills.
