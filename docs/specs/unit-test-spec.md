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

**How scenarios reach Claude (harness TBD):** The harness loads the scenario files and makes them available to Claude as project files. The exact mechanism — writing to a temp directory, injecting into the conversation, or using Claude Agent SDK file context — is undefined and will be determined when the harness is built. This is the riskiest undefined piece: skills that read files with `Read` or `cat` behave differently from skills that expect files at a known path. The harness must reproduce how Cowork presents project files to skills.

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

### Three-layer rubric

Grading uses the same three-layer structure as e2e tests:

| Layer | Defined where | Applies to | Who maintains |
|-------|--------------|------------|---------------|
| Base rubric | Shared across all skills | Every unit test | Developers |
| Skill rubric | `eval/tests/unit/<skill>/rubric.md` | Every test for one skill | Senior genealogists |
| Per-test criteria | `additional_criteria` in test JSON | One test only | Junior genealogists |

### Base rubric

Minimal dimensions that apply to every skill:

| Dimension | What the LLM judge evaluates |
|-----------|------------------------------|
| Correctness | Are the skill's outputs factually correct given the input state? Are claims supported by the provided sources and assertions? |
| Completeness | Did the skill address everything the input state and user message required? Were there omissions? |

Two dimensions. The skill rubric adds domain-specific depth.

### Skill rubrics

Each skill gets a `rubric.md` file in its test directory defining 3-5 grading dimensions specific to that skill. Examples:

**`eval/tests/unit/conflict-resolution/rubric.md`:**
- Source independence analysis: Did the skill assess whether competing sources are truly independent?
- Evidence weighing: Did the skill apply the GPS preponderance hierarchy (original > derivative, primary > secondary, contemporary > recollected)?
- Resolution completeness: Did the resolution address all competing assertions, not just the two most obvious?

**`eval/tests/unit/record-extraction/rubric.md`:**
- Assertion atomicity: Is each assertion a single extractable fact, not a compound claim?
- Informant identification: Did the skill identify the actual informant (not just "census") and assess proximity?
- Evidence type accuracy: Were direct, indirect, and negative evidence types assigned correctly?

**`eval/tests/unit/citation/rubric.md`:**
- Evidence Explained compliance: Does the citation follow the Who/What/When/Where/Where-within framework?
- Replication test: Could another researcher find the exact record using only this citation?
- Source vs information distinction: Is the source classified at the source level, not confused with information quality?

Cap at 5 dimensions per skill (plus the 2 base dimensions = 7 total). The grading prompt optimizer targets these rubrics.

Skill rubrics are written by senior genealogists during Phase 1 (golden set creation). Each rubric is self-contained — no cross-references between skills. 23 files of 5-10 lines each is manageable, and skills may diverge from initially similar rubrics as testing reveals different failure modes.

### How the three tiers interact

A test for record-extraction with 2 additional criteria is graded on:
- 2 base rubric dimensions (correctness, completeness)
- 3 skill rubric dimensions (atomicity, informant identification, evidence type accuracy)
- 2 additional criteria (case-specific)
- = 7 total grading points

A test with 0 additional criteria is still graded on 5 dimensions (2 base + 3 skill). This means a junior genealogist can create a useful test even if they only provide the scenario and user message — the rubric carries the primary grading weight.

### Grading layers

| Layer | What | How |
|-------|------|-----|
| Layer 1: Deterministic | Developer Python tests (schema, IDs, ownership) | pytest, runs on every test output |
| Layer 2: LLM judge | Base rubric + skill rubric + per-test additional criteria | Automated, scores each dimension |
| Layer 3: Human | Junior verification of LLM scores, senior adjudication | Annotation/adjudication files per `eval/CLAUDE.md` |

---

## 8. Developer Tests

Developer-written Python tests provide deterministic structural validation. They live alongside genealogist tests and run against the output of every skill invocation.

### Conventions

- Files follow pytest naming: `test_*.py`
- Live in `eval/harness/validators/`, one file per skill
- Use `@pytest.mark.slow` for tests that make real API calls
- Fast tests (default) validate skill output structurally — no API calls, no LLM calls
- Slow tests verify that MCP fixtures are still valid (API hasn't changed its response shape) and that tool integration works end-to-end

### Invocation

The harness runs pytest validators automatically after each test execution, before the LLM judge. Validator results (pass/fail per check) are included in the run log and visible in the CRUD UI alongside LLM judge scores. Juniors see validator failures immediately — they don't need to run pytest separately or wait for a dev report.

### Shared validators

Shared validation code lives in `eval/harness/` and will be developed as patterns emerge. The `research-schema-spec.md` is the source of truth for what invariants to check. Known areas:

- Schema validation (required fields, types, enum values)
- ID integrity (all referenced IDs exist in the input or output state)
- Ownership enforcement (skill only wrote to sections it owns)
- Append-only enforcement (log entries never modified)
- No-delete enforcement (entries superseded, not removed)
- ID format (correct prefixes: `a_`, `c_`, `src_`, etc.)

The exact API for these validators is not prescribed — developers will discover the right patterns when writing the first tests.

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

Unit tests are cheap relative to e2e tests. Each test runs one skill invocation with mocked tool responses (no API costs for FamilySearch). Estimated cost: **$0.10-1.00 per test** depending on skill complexity and input state size. Simple skills (wiki-lookup, convert-dates) are at the low end; complex skills (research-plan, record-extraction) with large scenario states and multiple fixture responses can reach the high end due to 10k+ input tokens.

Full suite (690+ tests): **$70-700 per run**. Affordable for iterative development but not free — run the full suite on PR branches, not on every local save.

Individual skill suites (30+ tests): **$3-30 per run**. Cheap enough for rapid iteration on a single skill.

---

## 12. Test Volume

The testing plan recommends 30+ tests per skill, split roughly 50/50 between positive and negative. With 23 skills, the target is 690+ tests total. Junior genealogists create these via the CRUD UI. Senior genealogists review a subset as golden sets for calibration.

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
