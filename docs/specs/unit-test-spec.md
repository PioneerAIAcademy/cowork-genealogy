# Unit Test Format Specification

**Project:** Cowork Genealogy — an AI genealogy research assistant
**Scope:** Skill-level evaluation tests written by genealogists, graded by LLM judge + human verification

---

## 1. Overview

Each unit test exercises a single skill in isolation: given a project state and a user message, does the skill produce correct output? Unit tests are the primary vehicle for iterative skill improvement (Phases 1-3 in the testing plan). They are cheaper and faster than e2e tests.

There are two kinds of tests per skill:

- **Genealogist tests** (JSON files) — scenario-based tests created by junior genealogists via the [eval CRUD UI](eval-crud-ui-spec.md). Graded by LLM judge using a three-layer rubric, then verified by humans.
- **Developer tests** (Python files) — deterministic structural validators written by developers. Run against the output of every genealogist test to catch schema violations, broken references, and ownership table breaches.

Unit tests serve two purposes:

1. **Skill quality** — Does the skill prompt guide Claude to produce correct genealogical output?
2. **Skill triggering** — Does the skill activate when it should and stay silent when it shouldn't?

Target volume: **10-20 tests per skill**, split roughly 50/50 between positive (should-trigger) and negative (should-not-trigger) cases. Negative tests emphasize near-misses — scenarios that look similar to the skill's trigger but should activate a different skill instead. See Section 12 for the volume rationale and how this relates to the description optimizer's needs.

### Scope and limitations (v1)

The format and harness in this spec target **single-turn skill evaluation**. The user sends one message; the skill produces output; the test ends.

**Multi-turn skills — covered via decomposition.** Two skills have multi-turn workflows in production. Both are testable in v1, but with reduced coverage:

- **`init-project`** — production workflow interviews the user about the research objective. For testing, put the full objective into `user_message`: *"Create a project to identify parents of Patrick Flynn, born ~1845 PA, died 1908 Schuylkill Co."* The skill should write a valid `research.json` and `tree.gedcomx.json` without needing follow-ups. v1 tests cover *structural output* but not *interview behavior* (does the skill ask the right clarifying questions when the message is vague?). Interview-flow coverage is deferred.
- **`search-external-sites`** — production workflow is "generate URL → user pastes capture → analyze capture." Decompose into two single-turn tests:
  - *URL generation test* — positive test under `search-external-sites`. The skill generates a search URL; grade on URL correctness, log entry shape.
  - *Capture analysis test* — positive test under `record-extraction` (the receiving skill) with the pasted capture content embedded in `user_message`. Grade as a normal extraction.
  - v1 covers both phases; what's lost is the *handoff* (does the skill correctly wait, or recover if the user pastes the wrong file?).

True multi-turn dialogue support (canned user replies, scripted turn arrays) is a future spec revision.

**Out of v1 scope:**

- **MCP-endpoint-only tests.** The master testing plan calls for unit tests on MCP endpoints with three axes (tool selection, argument quality, response interpretation). All three surface through a skill that calls the tool, and the MCP server has its own Vitest suite (`mcp-server/tests/`) for protocol/argument correctness. Tool usage is graded as a rubric dimension on the calling skill (Section 7), not as a standalone test.
- **Multi-turn dialogue support.** See above.
- **Skill chains.** A single test exercises one skill in isolation. Tests that span multiple skills (e.g., `research-plan` → `search-records` → `record-extraction`) belong in the e2e framework (`docs/specs/e2e-test-spec.md`).
- **Schema versioning.** Schema breakage is acceptable during build-out (per `research-schema-spec.md` §7). No migration story in v1.

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

Scenario creation tooling (the form-based UI that generates valid JSON) is specified in [`eval-crud-ui-spec.md`](eval-crud-ui-spec.md). Until that UI ships, scenarios are dev-authored; until a needed scenario exists, tests that reference it via `scenario_notes` fail the runnability gate (§9).

Scenarios are reusable. When a junior creates a new scenario (or a dev creates one on their behalf), other juniors can select it from the dropdown for their tests. The README.md is auto-generated from the scenario contents.

**When to create a new scenario vs reuse:** If an existing scenario is close to what you need, select it and describe the differences in `scenario_notes`. If 3+ tests need the same modification, promote to a new named scenario.

### 3.2 MCP Fixtures

MCP fixtures provide mocked tool responses. Each fixture is a single JSON file validated against [`docs/specs/schemas/mcp-fixture.schema.json`](schemas/mcp-fixture.schema.json):

```
eval/fixtures/mcp/<fixture-name>.json
```

Format:

```json
{
  "tool": "record_search",
  "description": "1860 census search for Flynn household in Schuylkill County PA",
  "args": { "args.collection_id": "1860_census" },
  "response": {
    "...MCP tool response JSON..."
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool` | string | yes | The MCP tool name this fixture applies to |
| `description` | string | yes | Human-readable description for the UI dropdown |
| `args` | object | yes | Argument-match predicate AND grading target. Keys are dotted paths into the tool call's `args` object; values are exact-match scalars or, if prefixed with `~`, case-insensitive substring matches. All keys must match for the fixture to fire during dispatch. The LLM judge also reads this block as the canonical expected args for the **Tool Arguments** base dimension (Section 7) |
| `response` | object | yes | The exact JSON response the harness returns when this tool is called |

**Match semantics.** When the skill calls a tool, the harness selects a response in this order:

1. Among fixtures whose `tool` matches the call, evaluate each fixture's `args` predicate in declaration order. The first whose predicate matches the call's actual args wins.
2. If no fixture matches, the harness returns a structured `fixture_not_found` error to the skill (Section 15). The Tool Arguments dimension scores this as **fail**: Claude called a tool the test didn't anticipate, which is a real signal even if the root cause is a missing fixture.

A fixture's `args` block is **always required and non-empty.** It serves two purposes: routing during dispatch (deciding which fixture answers a given call) and grading via the Tool Arguments base dimension (canonical expected args for the LLM judge to compare against Claude's actual args). The single source of truth keeps the two purposes consistent.

**Predicated fixtures have no usage limit.** A fixture fires on every matching call. There's no "match once then fall through" semantic — if a test needs different responses across calls with identical args, model the difference in some other arg key and use distinct predicates.

**Error fixtures.** To test how a skill handles error responses (auth failure, upstream 5xx, malformed response), set `response` to the error envelope the real MCP tool would return. The harness returns whatever object is in `response` verbatim — there is no separate "error" mode. Recommended shapes (match what the real MCP tools throw):

```json
// auth failure
{ "response": { "error": "auth_required", "message": "Token expired. Call the login tool." } }

// upstream failure
{ "response": { "error": "upstream_error", "status": 503, "message": "wiki-query-api unreachable" } }

// empty results (legitimate negative result, not an error — log_outcome: negative)
{ "response": { "results": [], "total": 0 } }
```

Error-fixture coverage is **optional in v1.** Skills should handle errors gracefully in production, but exhaustive error-path testing is a Phase 2 push — the v1 focus is happy-path and negative-result behavior. The format is defined here so juniors who want to write an error-path test can.

**Ownership:** Junior genealogists own fixture creation. The target state is a CRUD UI with two creation modes:

- **URL capture:** The genealogist pastes a record URL (e.g., a FamilySearch ARK). The UI calls the MCP tool against the live API, captures the response, and saves it as a fixture. The genealogist adds a description.
- **Manual entry:** For tools without URL-based lookup (e.g., `wikipedia_search`), the UI provides form fields for the response shape. The genealogist fills in the fields they understand (title, content summary) and the UI generates valid fixture JSON.

Fixture creation tooling (URL capture and form-based fixture authoring) is specified in [`eval-crud-ui-spec.md`](eval-crud-ui-spec.md). Until that UI ships, devs create fixtures by running tools against the live API and saving the response shape; the harness's `--capture` flag supports this workflow.

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
    "tags": ["string (freeform tags for filtering and grouping)"],
    "expected_outcome": "pass | xfail (default: pass)",
    "xfail_reason": "string (required when expected_outcome is xfail)"
  },

  "input": {
    "user_message": "string (what the user types)",
    "scenario": "string or null (name of a scenario in eval/fixtures/scenarios/)",
    "scenario_notes": "string or null (how this test's state differs from the base scenario)"
  },

  "mcp_fixtures": ["string (fixture file names from eval/fixtures/mcp/)"],

  "additional_criteria": [
    "string (case-specific grading criterion beyond the skill rubric)"
  ],

  "runs_per_test": "number (optional override; default 1)",
  "execution": {
    "max_turns": "number (optional)",
    "max_wall_clock_seconds": "number (optional)",
    "max_tool_calls": "number (optional)",
    "max_input_tokens_per_turn": "number (optional)"
  }
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
    "tags": ["string (freeform tags for filtering and grouping)"],
    "expected_outcome": "pass | xfail (default: pass)",
    "xfail_reason": "string (required when expected_outcome is xfail)"
  },

  "input": {
    "user_message": "string (what the user types)",
    "scenario": "string or null",
    "scenario_notes": "string or null"
  },

  "negative": {
    "correct_skill": ["string (skill names that should handle this instead — empty array means no skill should fire)"],
    "explanation": "string (why the tested skill should not activate)"
  },

  "additional_criteria": [
    "string (optional — criteria about how the skill should decline)"
  ],

  "runs_per_test": "number (optional override; default 1)",
  "execution": { "...same shape as positive..." }
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

The machine-readable schema lives at [`docs/specs/schemas/unit-test.schema.json`](schemas/unit-test.schema.json). The CRUD app validates test files against it on save; the harness validates on load. The version below is reproduced here for readers but the file is authoritative — if the two disagree, the file wins and this block should be updated.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "unit-test.schema.json",
  "title": "Cowork Genealogy Unit Test",
  "description": "A skill-level evaluation test for Cowork Genealogy.",
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
        },
        "expected_outcome": {
          "type": "string",
          "enum": ["pass", "xfail"],
          "default": "pass",
          "description": "Expected aggregated outcome. `xfail` marks a known-failing test so its failures aggregate to `outcome: xfail` rather than `fail` (not a regression). A test marked xfail that starts passing is reported as `xpass` — investigate before flipping to `pass`. Matches pytest convention."
        },
        "xfail_reason": {
          "type": "string",
          "description": "Required when expected_outcome is `xfail`. Brief explanation, ideally with an issue/PR link or removal condition (e.g., 'blocked on issue #312; remove this marker when MCP fixture caching lands')."
        }
      },
      "allOf": [
        {
          "if": {
            "properties": { "expected_outcome": { "const": "xfail" } },
            "required": ["expected_outcome"]
          },
          "then": { "required": ["xfail_reason"] }
        }
      ],
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
          "type": "array",
          "items": { "type": "string" },
          "description": "Skills that should handle this request instead. Each entry must be a valid skill directory name. Empty array means no skill should fire (out-of-scope user message). One entry means exactly that skill is expected. Multiple entries mean any one is acceptable."
        },
        "explanation": {
          "type": "string",
          "description": "Why the tested skill should not activate. Documents the boundary between the two skills."
        }
      },
      "additionalProperties": false
    },
    "runs_per_test": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "description": "Optional override of the harness default (1). See Section 7, Variance: runs per test."
    },
    "execution": {
      "type": "object",
      "properties": {
        "max_turns": { "type": "integer", "minimum": 1 },
        "max_wall_clock_seconds": { "type": "integer", "minimum": 1 },
        "max_tool_calls": { "type": "integer", "minimum": 1 },
        "max_input_tokens_per_turn": { "type": "integer", "minimum": 1 }
      },
      "description": "Optional per-test overrides of harness execution limits. Defaults documented in Section 15.",
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
| `id` | string | yes | Unique test ID with `ut_` prefix (e.g., `ut_record_extraction_001`). Auto-generated by the app from skill name + sequence. Positive and negative tests for a skill share the same sequence counter |
| `skill` | string | yes | Must match a directory name under `plugin/skills/`. Set by skill dropdown in the UI |
| `name` | string | yes | Short human-readable name shown in the test list view |
| `type` | string | yes | `"positive"` or `"negative"`. Determines which other fields are present |
| `description` | string | yes | 1-2 sentences explaining what this test verifies and why it matters |
| `tags` | string[] | yes | Freeform tags for filtering and grouping. May be empty. The UI uses these for filtering the test list. Useful tag dimensions: record type (`census`, `vital-record`, `probate`), time period (`1850`, `1860`), GPS concept (`informant-weighting`, `independence`, `negative-evidence`), test pattern (`near-miss`, `multi-person`, `stateless`) |
| `expected_outcome` | string | no | `"pass"` (default) or `"xfail"`. Marks a known-failing test. xfail tests still run; their failures aggregate to `outcome: xfail` (expected, not a regression). If an xfail test starts passing, the run reports `outcome: xpass` so the marker can be removed |
| `xfail_reason` | string | conditional | Required when `expected_outcome` is `"xfail"`. Brief explanation, ideally with an issue link and a removal condition (e.g., "blocked on #312; remove when fixed") |

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

**Multi-call handling.** When a test needs different responses for different invocations of the same tool, declare multiple fixtures with distinct `args` predicates (Section 3.2). Dispatch is predicate-only: among fixtures whose `tool` matches the call, the first whose `args` predicate matches the call's actual args wins.

**Unmatched calls.** If the skill calls a tool whose actual args don't match any fixture's `args` predicate, the harness returns a structured `fixture_not_found` error to the skill (Section 15). This is recorded in the run log and surfaced to the LLM judge — usually a sign the test is missing a fixture, and it scores the Tool Arguments base dimension as fail (Section 7).

### 5.4 `additional_criteria`

Array of plain English strings. Each criterion describes a case-specific aspect of correct behavior that goes beyond the skill rubric. The LLM judge evaluates these alongside the skill rubric dimensions.

The skill rubric (Section 7) covers general quality standards that apply to every test for that skill. `additional_criteria` captures things unique to this specific scenario that the rubric doesn't cover. The CRUD UI displays the skill's rubric dimensions so genealogists know what's already covered and can focus on what's specific to their test case.

A test with zero additional criteria is still graded on the base rubric (2 dimensions) + skill rubric (3-5 dimensions). This means a junior genealogist can create a useful test even if they only fill in the test metadata and user message — the rubric carries the primary grading weight.

Guidelines for writing additional criteria:

- **Focus on what's unique to this scenario.** Don't restate what the skill rubric already covers. If the rubric says "extraction completeness," don't add "should extract all facts." Instead add criteria about *this specific record's* unusual characteristics.
- **Be specific.** "Should extract assertions" is too vague. "Should extract assertions for at least 3 persons (head of household, wife, and Patrick)" is testable.
- **Include reasoning.** "Should classify 'son' as primary information with direct evidence — the 1860 census states relationships explicitly unlike 1850" tells the judge *why* the classification is correct.
- **State negatives when important.** "Should NOT call any MCP search tools — the record is already in context" catches a specific failure mode.
- **Stay neutral on contested conclusions.** Don't embed an answer key. The author of the test should not also be authoring the criterion that says "the right answer is X." The judge then "agrees" with the author by construction — this is the single biggest validity threat to LLM-as-judge grading. Apply the **neutrality test**: would a genealogist who reached the *opposite* conclusion still endorse this criterion as fair? If not, rewrite to grade the *reasoning*, not the verdict.

  | Leaky (don't write) | Neutral (do write) |
  |---|---|
  | "Should resolve the conflict in favor of the Irish birthplace, citing informant proximity." | "Resolution should explicitly weigh informant proximity (household_member vs family_not_present) as one factor, regardless of which birthplace is preferred." |
  | "Should classify the source as derivative." | "Classification should distinguish the original record from any indexed or transcribed copy in the source chain." |
  | "Should identify Thomas Flynn as Patrick's father." | "Should evaluate whether the household composition and ages support a parent-child relationship, and state the basis." |

  Senior genealogists review all golden-set additional_criteria for leakage; the master plan (`docs/gps/skill-mcp-testing-plan.md`) covers the review cadence.

### 5.5 `negative`

Only present when `test.type` is `"negative"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `correct_skill` | string[] | yes | Skills that should handle this request instead. Each entry must be a valid skill directory name. `[]` = no skill should fire (out-of-scope user message). `["x"]` = exactly skill x is expected. `["x", "y"]` = any one of these is acceptable |
| `explanation` | string | yes | Why the tested skill should not activate. Documents the boundary between the two skills so reviewers (and the description optimizer) understand the discrimination |

### 5.6 `runs_per_test`

Optional integer (1-10) overriding the harness default of 1 run per test. See Section 7, "Variance: runs per test," for how multi-run results are aggregated. The default of 1 is right for routine regression catching; bump to 3 for description-optimizer passes or golden-set calibration where variance detection matters.

### 5.7 `execution`

Optional object overriding the harness's default execution limits. All fields are optional; unspecified fields fall back to harness defaults (Section 15, "Execution limits"). Exceeding any limit aborts the run with `outcome: aborted` and skips the judge.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_turns` | integer | 20 | Maximum agent turns |
| `max_wall_clock_seconds` | integer | 300 | Maximum wall-clock seconds for the skill execution phase (excludes judge) |
| `max_tool_calls` | integer | 50 | Maximum MCP tool calls. Bounds fixture consumption and accidental fan-out |
| `max_input_tokens_per_turn` | integer | 200000 | Maximum input tokens to the model in any single turn |

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

For each confusable pair, create tests from both directions: a test in skill A's directory with `correct_skill: ["B"]`, and a corresponding test in skill B's directory with `correct_skill: ["A"]`.

### Activation: the `activated` field

For each run, the harness computes a derived boolean `output.activated` per the rules below. This single field replaces the ad-hoc references to skills_invoked / file writes / tool calls scattered through grading logic. Section 7's outcome formulas reference `activated`; the rules live here once.

**The skill under test is `activated: true` if any of the following is true:**

1. **Owned-section writes.** The skill wrote to any section it owns per the ownership table in `research-schema-spec.md` Section 4. Examples: conflict-resolution wrote to `conflicts`; record-extraction wrote to `assertions` or `sources`.
2. **Files created or modified.** The skill created or modified files in `cwd` other than those it normally reads (for stateless skills, e.g., wiki-lookup writing a markdown file in the user's working folder).
3. **MCP tool calls characteristic of the skill's workflow.** The skill called an MCP tool listed in its `allowed-tools` frontmatter for substantive work (not just an exploratory `Read`). Skills with no `allowed-tools` cannot activate by this branch.
4. **Skill invocation recorded by the harness.** `output.skills_invoked` contains the skill under test, *and* the skill produced a substantive response. **Substantive** is operationalized as: the response is either (a) ≥10 words long, OR (b) does not pattern-match as a routing acknowledgement — i.e., short responses must not mention any other skill name. This catches legitimate concise outputs like `convert-dates` → `"1850-03-15"` while still excluding the "I see you're asking about X, but Y skill handles this" pure-routing case. (v1.5 refined the original "more than a one-sentence acknowledgement" rule with this skill-name-aware heuristic after observing false-negatives on stateless skills that produce one-word outputs.) Pure routing without further action does not count as activation.

What does **not** count as activation:

- Reading project files. Skills routinely read `research.json` and `tree.gedcomx.json` to figure out whether they apply; reading alone is not activation.
- Calling no-side-effect MCP tools (e.g., `place_search` for context) and then declining.
- A one-line response that names a different skill and stops.

### Grading negative tests

Grading sequence for a negative test:

1. **Did the skill activate (`activated: true`)?** If yes, the run outcome is `fail`. If no, continue.
2. **Did the skill route to an acceptable alternative?** The harness checks `output.skills_invoked` against `negative.correct_skill`:
   - **`correct_skill: []`** — pass requires `skills_invoked` is also `[]`. No skill should fire; if any skill activated, fail.
   - **`correct_skill: ["x"]`** — pass requires `"x" ∈ skills_invoked`.
   - **`correct_skill: ["x", "y", ...]`** — pass requires at least one of the listed skills is in `skills_invoked`.

   Partial credit is reserved for the LLM judge to grade cases where the skill correctly declined but suggested the wrong alternative in its text response (rare; mostly applies when `skills_invoked` is empty but the text recommends a different skill).
3. **Additional criteria** (if present): evaluated by the LLM judge. Examples: "Should explicitly tell the user this looks like a search request" or "Should NOT call any MCP tools before declining."

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

**Base rubric** — three dimensions that apply to every skill:

| Dimension | What the judge evaluates |
|-----------|------------------------|
| Correctness | Are the skill's outputs factually correct given the input state? Are claims supported by the provided sources and assertions? |
| Completeness | Did the skill address everything the input state and user message required? Were there omissions? |
| Tool Arguments | Did Claude call MCP tools with args that match each matched fixture's declared `args` block? Substring (`~`-prefix) expectations on free-text fields tolerate paraphrase; identifier fields are strict. Multi-call holistically. **Special: N/A.** When the test made zero MCP tool calls, this dimension scores `null` (N/A) — it doesn't penalize stateless skills or tests that legitimately don't call tools. |

Base dimensions do **not** consume the 3–5 rubric budget. Skills are graded on 3 base + 3–5 skill rubric + 0–3 per-test criteria.

**Skill rubrics** — each skill gets a `rubric.md` defining 3-5 domain-specific dimensions. Cap at 5 per skill (plus 3 base = 8 total). The cap is a noise-control heuristic on the *stable* dimensions; per-test `additional_criteria` are not counted against it but should still be kept to 0-3 per test for the same reason. Each rubric is self-contained. Examples:

- conflict-resolution: source independence analysis, evidence weighing, resolution completeness
- record-extraction: assertion atomicity, informant identification, evidence type accuracy
- citation: Evidence Explained compliance, replication test, source vs information distinction

**`rubric.md` file format.** A parseable structure so the judge prompt can ingest it consistently:

```markdown
# <skill-name> Rubric

Brief 1-2 sentence statement of what the skill produces and what the rubric grades.

## <dimension name>

Plain-English statement of what this dimension evaluates.

- **pass:** criteria for a passing score
- **partial:** criteria for partial credit
- **fail:** criteria for failure

## <next dimension>

...
```

Conventions: H1 is the skill name, H2 is each dimension name (exactly one H2 per dimension), and each H2 section ends with the three bulleted criteria (`pass`, `partial`, `fail`). The judge prompt parses on H2 headers and the three bullets. Don't add extra H2s, footnotes, or appendices — they confuse parsing. If a dimension genuinely can't take a `partial`, write `**partial:** not applicable — this dimension is binary` rather than omitting the bullet.

**Tool-usage dimensions for MCP-calling skills.** Skills with `allowed-tools` in their frontmatter (search-records, search-full-text, locality-guide, etc.) must include at least one dimension covering MCP tool usage. This aligns with the three-axis breakdown in `docs/gps/skill-mcp-testing-plan.md` (tool selection, argument quality, response interpretation). Two patterns:

- **Single combined dimension:** "Tool usage — correct tool selected for the task, arguments well-formed and faithful to the user's request, response interpreted accurately." Use for skills with a single dominant tool.
- **Split dimensions:** "Argument quality" and "Response interpretation" as separate dimensions. Use for skills where tool selection is non-trivial (multiple plausible tools) or where the response shape is complex enough that interpretation is its own skill.

These dimensions consume the rubric's 3-5-dimension budget like any other; if the skill's domain reasoning is rich, factor tool usage into the combined form to leave room for substantive criteria. The judge sees `output.tool_calls` (Section 10) and can grade against the captured args and the fixture responses.

For skills where tool work *is* the work (e.g., `search-records`, `search-full-text`), it is acceptable for a majority of rubric dimensions to be tool-usage dimensions — splitting argument quality, tool selection, and response interpretation across 3 of 5 dimensions, with 2 dimensions remaining for domain reasoning. The "at least one" floor and the 5-dimension cap stand; what flexes is the balance between tool-usage and domain dimensions.

**Tool-usage rubric ≠ tool allowlist validator.** These are independent layers. The Section 8 allowlist validator checks *whether the tool was permitted* (a deterministic, binary "did you stay within your `allowed-tools` frontmatter?" check). The tool-usage rubric dimension grades *how well the permitted tools were used* (argument quality, response interpretation). A skill can pass the allowlist (used only permitted tools) and fail tool-usage (used them poorly), or vice versa.

**Why some dimensions stay at skill level rather than promoted to base.** The base rubric is intentionally minimal (correctness + completeness) because it applies to every skill. Dimensions like citation discipline, evidence weighting, and identity resolution might look cross-cutting but don't apply to stateless skills (`wiki-lookup`, `translation`, `convert-dates`) that have no informants, no citations to discipline, and no identities to resolve. Forcing them into the base would mean grading those skills on dimensions that don't fit. They stay as per-skill rubric dimensions for the skills they actually apply to.

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

#### Judge prompt template

The judge prompt template lives at `eval/harness/judge/prompt.md`. The system preamble (grading instructions, base rubric, neutrality guardrail, output protocol) is inlined as fixed text. Only the per-test slots below are interpolated by the harness:

```
{rubric}                            — contents of eval/tests/unit/<skill>/rubric.md
{additional_criteria}               — bullet list from the test JSON
{scenario_readme}                   — scenario README.md, or "(stateless test)"
{user_message}                      — verbatim from the test
{skills_invoked}                    — list of skills Claude actually invoked
{text_response}                     — Claude's full output text (or sidecar ref)
{file_changes_summary}              — pre-rendered diff summary, ~500 tokens max
{tool_calls}                        — list of MCP calls with args + matched fixture
```

`{skills_invoked}` is provided to the judge as diagnostic context, not as a grading input. The wrong-skill detection for positive and negative tests is already deterministic (Section 7 per-run outcome) — the judge doesn't decide whether the right skill was chosen, only how well it executed. Including `skills_invoked` in the prompt lets the judge write more grounded rationales ("the right skill was invoked but it skipped the citation step") rather than guessing what ran.

The template is versioned with the harness; its SHA-256 hash is recorded in the run log as `judge_prompt_hash`. The skill rubric's content hash is recorded as `rubric_hash`. A change to either invalidates apples-to-apples comparison with prior runs and forces a re-baseline.

**Structured output.** The judge invokes Claude with tool_use forcing a single tool call against a `submit_grading` tool with this input schema:

```json
{
  "type": "object",
  "required": ["dimensions"],
  "properties": {
    "dimensions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source", "name", "score", "rationale"],
        "properties": {
          "source":    { "enum": ["base", "rubric", "criteria"] },
          "name":      { "type": "string" },
          "score":     { "enum": [1, 2, 3] },
          "rationale": { "type": "string", "minLength": 20 }
        }
      }
    }
  }
}
```

Forced tool_use eliminates parsing brittleness — there is no "extract JSON from prose" step. The harness expects exactly one tool call; multiple calls or no calls are treated as a judge failure and surfaced in the run log (rare; usually a prompt-template bug, not a model bug).

The minimum rationale length (20 chars) blocks one-word rationales — those correlate strongly with the judge guessing rather than reading.

### Layer 3: Human verification

The team submitting the PR writes one `.ann.json` file per run log, containing corrected scores for every judge dimension of every test. Senior genealogists review the corrected grades via GitHub PR comments — there is no separate adjudication artifact. See `docs/plan/per-pr-review-workflow.md` for the full workflow and `eval/CLAUDE.md` for filename conventions.

Per-dimension scores at every layer (judge tool_use, run log, `.ann` file, CRUD UI) use the same integer scale: **`3` = pass, `2` = partial, `1` = fail.** The semantic labels (pass/partial/fail) live in the judge prompt's instruction text and in each dimension's `**pass:** / **partial:** / **fail:**` bullets in `rubric.md`; the data field itself is just the integer. The monthly judge-prompt review (per the per-PR workflow plan §2.6) reads `.ann` files and computes `llm_score - corrected_score` deltas grouped by `(dimension_source, dimension_name)` to identify systematic LLM-judge drift.

`.ann` file format: [`docs/specs/schemas/ann.schema.json`](schemas/ann.schema.json).

(The run-log-level `outcome` field — `pass | partial | fail | aborted | xfail | xpass` — is a different concept and remains a string enum. It aggregates per-run outcomes for dashboard reporting; per-dimension scores aggregate to it via the rules in "Per-run outcome" below.)

### Per-run outcome

Each individual run of a test resolves to one of four outcomes:

| Outcome | When |
|---------|------|
| `pass` | All deterministic validators passed AND (for positive tests) every judge dimension scored `3` (pass) AND `output.activated` matches the test type: `true` for positive with the skill under test in `output.skills_invoked`; `false` for negative AND the `negative.correct_skill` array match rule (Section 6) is satisfied |
| `partial` | All validators passed AND any judge dimension scored `2` (partial) but none scored `1` (fail). For positive tests only — negative tests don't have rubric dimensions, so partial doesn't apply |
| `fail` | Any validator failed, OR any judge dimension scored `1` (fail), OR a positive test invoked the wrong skill, OR a negative test invoked the skill under test |
| `aborted` | Execution exceeded a budget guardrail (Section 15). The judge is not run. Not a fail — flagged separately so it doesn't count as a quality regression |

`expected_outcome: xfail` (Section 5.1) reframes the outcome to match pytest convention: an xfail-marked test that resolves to `fail` is reported as `xfail` (expected failure — does not count as a regression on the dashboard), and one that resolves to `pass` is reported as `xpass` (unexpected pass — investigate whether the bug is fixed and the marker can be removed).

**Why `partial` is its own bucket.** A skill that's mostly correct but loses a single rubric dimension is not equivalent to one that violated the schema. Partial outcomes are visible separately so dashboards can show "correctness regressions" distinct from "quality drift." For PR gating, treat partial as fail by default; for trend tracking, keep them separate.

### Variance: runs per test

Models are nondeterministic even at `temperature=0` — tool-selection and structured-output sampling produce run-to-run variation independent of decoding temperature.

**Default: N=1 run per test.** Combined with `temperature=0` (Section 15), this gives stable, low-cost regression catching for day-to-day iteration. A single run is the right grain for PR gating, dev-time iteration, and the suite-level dashboard.

**N=3 (or higher) is recommended for two specific cases:**

- **Description-optimizer passes.** When the optimizer compares two SKILL.md descriptions, it relies on pass-rate deltas across the test set (e.g., 60% → 70%). At N=1 those deltas are dominated by sampling noise. Bump `runs_per_test: 3` on the tests being scored against during an optimization pass; revert to N=1 afterward for routine runs.
- **Golden-set calibration.** Tests under active senior-genealogist calibration benefit from variance detection (`flaky: true` signals an unstable test) to identify rubric items that need tightening.

For everything else, N=1 is the right choice — the cost saving is ~2.5x and the lost signal (flakiness detection) is recoverable by re-running the test manually when something looks off.

The harness executes the test N times (one for N=1, three for N=3, etc.) and stores every run in the run log (Section 10).

**Aggregated outcome.** The aggregated `outcome` is the modal per-run outcome with ties resolving toward the lower score (`fail` < `partial` < `pass`; `aborted` is its own bucket and not part of the rank order — see below).

| Per-run results | Aggregated `outcome` |
|----------------|----------------------|
| 3/3 pass | `pass` |
| 3/3 fail | `fail` |
| 3/3 partial | `partial` |
| 2 pass, 1 fail | `pass` (modal) |
| 1 pass, 1 partial, 1 fail | `fail` (tie-break down) |
| Any aborted | aborted dominates: `aborted` (also sets `flaky` if other runs disagreed) |

**Why these tie-break rules:**

- **3-way splits collapse down.** When N=3 produces three different outcomes, there is no genuine signal of correctness — the skill is unstable on this test. Collapsing to `fail` matches how engineers actually treat flapping tests: assume the worst case and investigate. The `flaky: true` flag (always set in this case) preserves the underlying instability signal for anyone reading the dashboard.
- **`aborted` dominates rather than being averaged out.** An abort means the skill hit a hard limit (max_turns, max_tool_calls, etc.) — failing to converge is itself a failure mode worth flagging, not infrastructure noise to discount. If real infrastructure noise becomes a problem (rate limit hits, network blips), the right fix is a new `aborted_reason` category that aggregates separately, not relaxing this rule.

**`flaky` is a boolean flag, not an outcome.** It's true when the per-run outcomes are not unanimous. It composes orthogonally with `outcome`:

- A test with runs `(pass, pass, fail)` has `outcome: pass, flaky: true` — the modal signal says the skill is correct, but the test is unstable.
- A test with runs `(pass, pass, pass)` has `outcome: pass, flaky: false` — stable pass.
- A test with runs `(fail, fail, fail)` has `outcome: fail, flaky: false` — stable fail.

This composition cleanly handles all edge cases:

- **xfail tests:** xfail reframes `outcome` (a `fail` becomes `xfail`, a `pass` becomes `xpass`) but does not affect `flaky`. An xfail test that's also flaky stays flaky.
- **Dashboard semantics:** "pass rate" excludes flaky tests by default (they aren't a stable signal either way); "flake rate" is reported alongside. Treat `flaky: true` like a yellow caution light, regardless of which color the outcome shows.

**Per-run aggregation of judge dimensions.** Within a single run, the judge produces one integer score per dimension. Across N runs the aggregated dimension score is the modal value (most common); ties resolve toward the lower score (`1` < `2` < `3`). The aggregated rationale is the rationale from the modal run. Dimension aggregation and outcome aggregation are independent — a `flaky: true, outcome: pass` test can have all-`3` aggregated dimensions, because flaky measures run-to-run *stability* and dimensions measure *per-run consensus on individual rubric items*. The reviewer-facing display should show both: "this test passed 2/3 runs; the dimensions that fired all scored `3`."

**Overrides.** The schema's optional `runs_per_test` field (Section 4) bumps the count above the default of 1 in these specific cases:

- `runs_per_test: 3` — description-optimizer passes (so pass-rate deltas aren't dominated by sampling noise) and golden-set calibration during rubric tuning.
- `runs_per_test: 5+` — only when calibrating a high-variance rubric dimension and you specifically need a tighter estimate of per-dimension stability.

Because the default is N=1, `flaky` only ever fires during these optimization and calibration runs; routine regression dashboards will not surface borderline cases on their own — re-run a suspect test manually with `runs_per_test: 3` when something looks off.

**Cost impact.** Running N=3 triples skill-execution cost and (when validators pass) judge cost. Prompt caching mitigates the skill-execution side — only the test-specific tail re-runs uncached. Budget impact is roughly 2.5x rather than 3x for batched skill runs. Because N=1 is the default, this cost only applies during optimization passes and calibration work.

### Stability floor (TBD)

At `temperature=0`, Sonnet is documented as not fully deterministic — tool selection and structured output sampling produce run-to-run variation. The spec does not yet pin a "regression threshold" (e.g., "pass rate drop > X% on a skill counts as a regression vs noise") because it cannot be set without empirical baseline data. After the first golden-set run with N=5 produces a noise characterization, this section gets filled in with:

- A per-skill pass-rate noise band (the expected variation when nothing has changed).
- A regression threshold (pass-rate drop exceeding the noise band).
- A monthly "stability run" cadence — N=5 on the golden set against the current pinned model + harness_version + rubric_hash + judge_prompt_hash, to recalibrate the noise band as those inputs evolve.

Until then, treat any single pass-rate drop as a signal worth investigating manually rather than auto-classifying as regression vs noise.

---

## 8. Deterministic Validators

Validators provide structural correctness checks. They run automatically after each test execution, before the LLM judge. If any validator fails, the LLM judge is skipped (saves cost — the test already failed structurally).

**Source of truth.** The JSON Schema files under `docs/specs/schemas/` are canonical for structural validity (shape, types, enums, ID prefixes, conditional fields). The prose tables in `research-schema-spec.md` and `simplified-gedcomx-spec.md` are derived documentation — when the schema changes, update the schema file first, then resync the prose. Validators must use `jsonschema` against the schema files rather than reimplementing field/type checks in Python.

Validator results (pass/fail per check) are included in the run log and visible in the CRUD UI. Juniors see validator failures immediately.

### Validator inputs

The harness provides validators with:
- The scenario files (before state)
- The output files (after state)
- The list of MCP tool calls made (tool name, arguments, responses)

Validators compute the diff internally from before/after state.

### Universal validators (all skills)

Shared validation code in `eval/harness/validators/`. These run on every test regardless of skill.

- **Schema validation** — validates `research.json` against [`docs/specs/schemas/research.schema.json`](schemas/research.schema.json) and `tree.gedcomx.json` against [`docs/specs/schemas/tree-gedcomx.schema.json`](schemas/tree-gedcomx.schema.json). Catches required-field omissions, wrong types, invalid enum values, and ID-prefix violations. Operates on the full output. Use the `jsonschema` library against the machine-readable schemas — do not reimplement these checks in Python.
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

- Universal validators live in `eval/harness/validators/test_universal.py`
- Skill-specific validators live in `eval/harness/validators/test_<skill>.py`, one file per skill
- Validators are plain Python functions with the signature `def test_<name>(before_state, after_state, tool_calls)` and raise `AssertionError` on failure
- The harness calls validators as direct function calls (not via pytest subprocess) for speed and reliability
- Developers can also run validators standalone with `pytest eval/harness/validators/ -v` for debugging — pytest invokes them with fixtures the harness provides; see `eval/harness/validators/conftest.py`

### Validator signature

All validators take the same three arguments. Validators that don't need an argument simply ignore it:

```python
def test_log_append_only(before_state, after_state, tool_calls):
    """Universal: log entries never modified or deleted."""
    before_log = before_state["research_json"]["log"]
    after_log = after_state["research_json"]["log"]
    for entry in before_log:
        assert entry in after_log, f"log entry {entry['id']} was modified or removed"

def test_tool_allowlist(before_state, after_state, tool_calls):
    """Skill-specific: only tools in SKILL.md frontmatter were called."""
    allowed = before_state["skill_frontmatter"].get("allowed-tools", [])
    for call in tool_calls:
        # Strip the mcp__<server>__ prefix
        bare_name = call["tool"].split("__")[-1]
        assert bare_name in allowed, f"skill called {bare_name}, not in allowed-tools"
```

**The three arguments:**

- `before_state` (dict) — `{"research_json": {...}, "tree_gedcomx_json": {...}, "files": {<path>: <content>}, "skill_frontmatter": {...}}`. Files present in the temp dir before the skill ran. `research_json` and `tree_gedcomx_json` are convenience aliases for the parsed contents of those files; absent if the test is stateless. `skill_frontmatter` is the parsed YAML frontmatter of the skill under test's SKILL.md.
- `after_state` (dict) — same shape as `before_state`, snapshotting state after the skill ran. Files created during the run appear here with no `before` counterpart.
- `tool_calls` (list) — every MCP tool call made by the skill, with the shape `{"tool": "mcp__genealogy__record_search", "args": {...}, "matched": {...}, "response_fixture": "..."}` (Section 10).

Validators compute the diff between `before_state` and `after_state` internally. The harness does not pre-compute the diff for validators — they have full state for cases like the append-only check that need to compare collections, not just diffs.

### Invocation

The harness calls validator functions directly and catches assertion errors:

```python
def run_validators(skill_name, before_state, after_state, tool_calls):
    results = []

    for fn in get_test_functions(test_universal):
        results.append(run_one(fn, before_state, after_state, tool_calls))

    skill_module = load_skill_validators(skill_name)
    if skill_module:
        for fn in get_test_functions(skill_module):
            results.append(run_one(fn, before_state, after_state, tool_calls))

    return results

def run_one(fn, before_state, after_state, tool_calls):
    try:
        fn(before_state, after_state, tool_calls)
        return {"name": fn.__name__, "passed": True, "error": None}
    except AssertionError as e:
        return {"name": fn.__name__, "passed": False, "error": str(e)}
```

The `research-schema-spec.md` ownership table is the source of truth for structural invariants. The machine-readable schemas under `docs/specs/schemas/` are the source of truth for shape validity — universal validators should use `jsonschema` against those rather than reimplementing field/type checks.

---

## 9. Pre-flight Conditions

Before the harness executes a test, it runs the runnability gate below. Test authoring workflow lives in [`eval-crud-ui-spec.md`](eval-crud-ui-spec.md); senior review cadence, calibration protocols, and Phase 1 bootstrap sequencing live in [`docs/gps/skill-mcp-testing-plan.md`](../gps/skill-mcp-testing-plan.md). This section covers only what the harness checks.

### Runnability gate

The harness refuses to execute a test if any of the following are true. The check runs before the skill is launched; the run log is written with `outcome: aborted` and `aborted_reason: not_runnable`.

| Condition | Why blocked |
|-----------|-------------|
| `scenario_notes` is a non-empty string | The scenario doesn't match the test's stated needs. Running anyway grades the skill against the wrong reality |
| The referenced `scenario` directory does not exist | Test points at a scenario that hasn't been created |
| Any referenced fixture in `mcp_fixtures` does not exist | Test points at a fixture that hasn't been created |
| The scenario's `research.json` or `tree.gedcomx.json` does not validate against its schema | A broken scenario silently fails every test that uses it; gate it instead |
| The skill referenced by `test.skill` does not exist in `plugin/skills/` | Test points at a skill that has been removed or renamed |
| The skill's `rubric.md` does not exist or fails to parse per the format in Section 7 | The harness can't compute `rubric_hash`, can't load dimensions, and the judge prompt slot would be empty. Block rather than grade against an empty rubric |
| For MCP-calling skills (`allowed-tools` non-empty in frontmatter), the `rubric.md` has no tool-usage dimension | Section 7 requires at least one tool-usage dimension (substring match against `tool usage`, `argument quality`, `response interpretation`, `tool selection`, `mcp tool`, `tool work`, `tool call`, or `fixture` in any dimension name). Block rather than grade tool quality with no rubric dimension covering it |
| For negative tests, any entry in `negative.correct_skill` is not a directory under `plugin/skills/` | A typo silently produces an unsatisfiable test — Claude can route correctly and the test still fails. Catch at gate time with a clear "correct_skill[i]='X' is not an existing skill" message |

The CRUD UI ([`eval-crud-ui-spec.md`](eval-crud-ui-spec.md)) surfaces non-runnable tests so authors can see their tests are waiting on dev work without burning runs.

---

## 10. Run Log Format

When the harness executes a unit test, it writes a run log to:

```
eval/runlogs/unit/<skill-name>/<model-version>/YYYY-MM-DDTHH-MM-SSZ.json
```

The timestamp is UTC second-resolution, filename-safe (no colons). Same-second collisions raise `RunlogCollisionError` rather than overwriting the prior log; v1 serial execution makes collisions rare, so the operator simply waits a second and re-runs.

Including the model version in the path makes it easy to compare runs across model versions.

**Annotations** use the per-PR convention defined in `docs/plan/per-pr-review-workflow.md` §2.3 and the schema at [`docs/specs/schemas/ann.schema.json`](schemas/ann.schema.json):

```
YYYY-MM-DDTHH-MM-SSZ.ann.json    # team's corrected grades for this run
```

One `.ann` file per run log per PR, written by the team submitting the PR. Senior feedback flows through GitHub PR comments — there is no separate `.adj` adjudication file.

**Optimizer runs** (description-optimizer + body-optimizer passes per master testing plan Appendix C) write to a separate subdirectory:

```
eval/runlogs/optimizer/<skill-name>/<model-version>/YYYY-MM-DDTHH-MM-SSZ.json
```

These are excluded from cross-PR comparison and from the `.github/workflows/check-runlogs.yml` Action's runlog-count check. They are not annotated.

### Run log schema

A run log represents N runs of one test (N from `runs_per_test`, default 1). The top-level `outcome` is the aggregated outcome (Section 7); per-run detail lives in `runs[]`. When N=1, `runs[]` has one entry and `flaky` is always false. Machine-readable schema: [`docs/specs/schemas/run-log.schema.json`](schemas/run-log.schema.json).

```json
{
  "test_id": "string (ut_ prefix, references the test JSON)",
  "skill": "string (skill directory name)",
  "test_type": "string (positive | negative)",
  "expected_outcome": "string (pass | xfail — echoed from the test JSON)",
  "timestamp": "string (ISO 8601 with timezone of the first run)",

  "harness_version": "string (semver of the harness package — e.g. 0.4.2)",
  "model": "string (pinned model version, e.g. claude-sonnet-4-6-20250514)",
  "judge_model": "string (e.g. claude-haiku-4-5-20251001)",
  "rubric_hash": "string (SHA-256 of eval/tests/unit/<skill>/rubric.md at run time)",
  "judge_prompt_hash": "string (SHA-256 of eval/harness/judge/prompt.md at run time)",
  "test_content_hash": "string (SHA-256 of the resolved test — test JSON minus cosmetic fields + scenario directory contents + referenced fixture file contents — used by cross-PR comparison to auto-exclude tests whose grading-relevant content changed; see docs/plan/per-pr-review-workflow.md §2.4)",

  "scenario": "string or null (scenario directory name)",
  "mcp_fixtures": ["string (fixture file names used)"],

  "outcome": "string (pass | partial | fail | aborted | xfail | xpass)",
  "flaky": "boolean (true when per-run outcomes are not unanimous)",
  "outcome_summary": {
    "per_run_outcomes": ["string (one entry per run: pass | partial | fail | aborted)"],
    "aggregated_dimensions": [
      {
        "source": "string (base | rubric | criteria)",
        "name": "string",
        "score": "integer (1 | 2 | 3 — modal across runs; 1=fail, 2=partial, 3=pass)",
        "rationale": "string (rationale from the modal run)"
      }
    ]
  },

  "totals": {
    "duration_ms": "number (sum of all runs)",
    "input_tokens": "number",
    "cached_input_tokens": "number (cache hits — should be substantial across N>1 runs)",
    "output_tokens": "number",
    "skill_cost_usd": "number (sum across runs)",
    "judge_cost_usd": "number (sum across runs)",
    "total_cost_usd": "number"
  },

  "runs": [
    {
      "run_index": "number (0-based)",
      "run_id": "string (run_<test_id>_<timestamp>_<run_index>)",
      "outcome": "string (pass | partial | fail | aborted)",
      "aborted_reason": "string or null (limit name or `not_runnable` when outcome is aborted; null otherwise)",
      "duration_ms": "number",
      "input_tokens": "number",
      "cached_input_tokens": "number",
      "output_tokens": "number",
      "skill_cost_usd": "number",

      "output": {
        "text_response": "string (Claude's full response text — reasoning, explanations, instructions)",
        "activated": "boolean (derived from Section 6 rules — true if the skill under test substantively activated)",
        "skills_invoked": ["string (skill directory names invoked during this run, in order)"],
        "file_changes": {
          "research.json": {
            "sections_modified": ["string (section names that changed)"],
            "diff": {
              "<section_name>": {
                "added": ["object (new entries, full content)"],
                "modified": [
                  {
                    "id": "string",
                    "changed_fields": {
                      "<field_name>": {
                        "before": "any",
                        "after": "any"
                      }
                    }
                  }
                ],
                "deleted": ["object (should always be empty if validators pass)"]
              }
            }
          },
          "tree.gedcomx.json": "same structure as research.json, or null if unchanged"
        },
        "tool_calls": [
          {
            "tool": "string (full tool name, e.g. mcp__genealogy__record_search)",
            "args": "object (arguments Claude actually passed)",
            "expected_args": "object or null (canonical expected args from the matched fixture's `args` block; null when no fixture matched)",
            "matched": {
              "kind": "string (predicate | none)",
              "index": "number or null"
            },
            "response_fixture": "string or null (fixture file name that provided the response, null when kind is `none`)"
          }
        ],
        "files_created": ["string (paths of new files created, relative to cwd)"]
      },

      "validators": {
        "passed": "boolean",
        "results": [
          {
            "name": "string (validator function name, e.g. test_log_append_only)",
            "passed": "boolean",
            "error": "string or null (assertion error message when failed)"
          }
        ]
      },

      "judge": {
        "skipped": "boolean (true when validators failed or run was aborted)",
        "dimensions": [
          {
            "source": "string (base | rubric | criteria)",
            "name": "string (dimension name or criterion text)",
            "score": "1 | 2 | 3 | null  (1=fail, 2=partial, 3=pass; null=N/A — currently only on the Tool Arguments base dimension when zero MCP tool calls)",
            "rationale": "string"
          }
        ],
        "judge_cost_usd": "number (0 when skipped)"
      }
    }
  ]
}
```

**Field details:**

- **`outcome`** — aggregated across runs per Section 7. `xfail` means an `xfail`-marked test failed (the bug is still there, as expected — not a regression). `xpass` means an xfail-marked test passed (investigate — the marker may be stale). Matches pytest convention.
- **`flaky`** — true when the per-run outcomes are not unanimous. Composes orthogonally with `outcome` (Section 7). A test can be `outcome: pass, flaky: true` (modal-passing but unstable).
- **`harness_version`** — the semver of the harness package. Bumping the harness (new validator, new judge prompt scaffolding, fixture-matching changes) invalidates apples-to-apples comparison with prior runs. Pinning the version makes that explicit.
- **`rubric_hash` / `judge_prompt_hash`** — SHA-256 of the rubric and judge prompt template files at run time. A change to either silently invalidates historical scores; recording the hash forces a re-baseline rather than letting old runs look comparable.
- **`totals.cached_input_tokens`** — input tokens served from the prompt cache. For a batched skill suite (all tests for one skill run consecutively), this should be 50%+ of `input_tokens` even at N=1, because the skill prompt is identical across tests within the batch. With N=3 batched, expect 70%+. Lower numbers indicate caching isn't firing and costs will be higher than estimated in Section 11.
- **`outcome_summary.aggregated_dimensions`** — modal dimension scores across runs (ties resolve toward the lower score). Used by dashboards; per-run dimension scores remain in `runs[].judge.dimensions` for human review.

  **Stratified scoring.** Each dimension carries `source: base | rubric | criteria`. The number of `criteria` dimensions varies per test (driven by `additional_criteria` length), so suite-level pass rates are only apples-to-apples within a single `source` bucket. Dashboards should compute and track `base_pass_rate`, `rubric_pass_rate`, and `criteria_pass_rate` separately for each skill — combining them into a single rate makes the denominator drift as criteria counts change across tests.

- **`runs[].output.activated`** — derived boolean from Section 6's four-rule definition. Positive tests pass when `activated: true`; negative tests pass when `activated: false`. Having it as a derived field keeps Section 7's outcome formulas simple and prevents drift between activation logic and grading logic.
- **`runs[].output.skills_invoked`** — the skill(s) Claude actually invoked. Combined with `activated`, drives the wrong-skill check for positive tests and the `correct_skill` array match for negative tests (Section 6).
- **`runs[].output.tool_calls[].matched`** — distinguishes calls that hit a fixture (`kind: "predicate"`) from unmatched calls (`kind: "none"`, which returned a `fixture_not_found` error to the skill). Unmatched calls score the Tool Arguments base dimension as fail — Claude called a tool the test didn't anticipate.
- **`runs[].output.tool_calls[].expected_args`** — the matched fixture's `args` block (the canonical expected args), copied so the trace view and judge prompt can render expected/actual side-by-side without re-reading the fixture file. Null when no fixture matched.
- **`runs[].output.text_response`** — Claude's full response, not truncated. If a single run's text exceeds 100 KB, the harness writes it to a sidecar file (`runs/<run_id>.text.md`) and stores a reference (`{ "ref": "runs/<run_id>.text.md" }`) in the log instead, to keep the JSON tractable.
- **`runs[].output.file_changes.diff`** — structured diff with full before/after values for modified fields. For a modified entry, fields that didn't exist on the `before` object are emitted as `{"before": null, "after": <value>}` (added field); fields removed from the `after` object are emitted as `{"before": <value>, "after": null}` (removed field). Use literal `null`, not absent keys, so the judge always sees a uniform shape. `deleted` should always be empty (no-delete enforcement); if it's not, the validator already caught it.
- **Tool call repetition.** The fixture matching logic (Section 3.2) reuses the last unpredicated fixture when a tool is called more times than fixtures exist for it. This is intentional for the common single-fixture-for-repeated-calls pattern, but it means a skill that calls a tool *more times than expected* will silently receive copies of the same response. The judge sees every tool call in `runs[].output.tool_calls`, including repeats — tool-usage rubric dimensions (Section 7) should consider call-count plausibility ("did the skill make ~the right number of calls for the task?") rather than assuming each call returned new data.
- **`runs[].aborted_reason`** — one of `max_turns`, `max_wall_clock_seconds`, `max_tool_calls`, `max_input_tokens_per_turn`, `not_runnable` (Section 9 runnability gate), or `error` (the SDK or harness raised an uncaught exception during skill execution). Null when the run was not aborted.
- **`runs[].validators.passed`** — top-level boolean per run for at-a-glance status.
- **`runs[].judge.skipped`** — true when validators failed in this run *or* the run was aborted. When skipped, `dimensions` is an empty array and `judge_cost_usd` is 0.
- **`totals.skill_cost_usd` + `totals.judge_cost_usd`** — separated so the UI can show skill execution cost vs judge cost independently.

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

4. **Input trimming is deferred to a later version.** The earlier draft of this spec proposed trimming `research.json` to only the sections each skill reads. v1 sends the full scenario files unchanged — this matches what Cowork does in production and removes a class of bugs where a skill behaves differently in eval because trimming hid state. Re-evaluate trimming if `cached_input_tokens` rates fall below target and per-run costs prove materially higher than estimated.

### Estimated costs

Costs assume prompt caching is firing and are quoted **per run**. The harness default is N=1 (Section 7), so these are the headline figures. For description-optimizer passes or golden-set calibration with N=3, multiply by ~2.5 (caching damps the per-run multiplier below 3x). Verify caching with `totals.cached_input_tokens` in the run log — should be 50%+ for N=1 batched runs, 70%+ for N=3 batched runs.

Most tests are mid-complexity (~$0.10-0.20 per run). Simple stateless skills (wiki-lookup, convert-dates) are at the low end (~$0.03). Complex synthesis skills (proof-conclusion, research-plan) are at the high end (~$0.40).

| Scope | Default (N=1) | Optimizer pass (N=3) |
|-------|---------------|----------------------|
| Single test | $0.03-0.40 | $0.08-1.00 |
| One skill (10-20 tests) | $1.50-3 | $4-8 |
| Full suite (230-460 tests) | $35-70 | $90-180 |

Affordable for iterative development. Run individual skill suites during active development. Run the full suite on PR branches, not on every local save. The optimizer column applies only to skills currently in an optimization pass; the rest of the suite stays at N=1.

---

## 12. Test Volume

Target: **10-20 tests per skill**, split roughly 50/50 between positive and negative:

- 5-10 positive tests covering the skill's main use cases
- 5-10 negative tests covering confusable-skill boundaries

With 23 in-scope skills (excluding multi-turn skills — see Section 1), the target is **230-460 tests total**. This is enough to catch regressions and give the LLM judge meaningful signal. More tests per skill yields diminishing returns — the 15th conflict-resolution test teaches less than the 5th.

**Relationship to the description optimizer.** The master testing plan (`docs/gps/skill-mcp-testing-plan.md`, Appendix C) cites ~30 labeled queries as a typical setup for low-variance candidate ranking in description optimization. The optimizer works with fewer — 10-20 well-chosen tests yield usable signal — but candidate scoring is noisier and a strict 60/40 train/test split becomes thin. Mitigations: skip per-skill holdout and rely on senior review of proposed descriptions, or treat boundary tests from confusable-skill pairs as cross-skill holdouts. Authoring an additional 10 synthetic queries per skill at optimization time is also acceptable; those queries are ephemeral and need not be checked into `eval/tests/unit/`.

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
    "correct_skill": ["search-records"],
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

  "mcp_fixtures": ["wikipedia-search-schuylkill-county"],

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

### 13.5 Positive test with scenario_notes: research-plan

This example shows a test in "needs scenario work" state — the closest scenario doesn't match, so the author wrote `scenario_notes` to describe the gap. The runnability gate (§9) blocks execution until a matching scenario is created and the test is updated to reference it (with empty `scenario_notes`).

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

Unit tests and e2e tests are complementary (see `e2e-test-spec.md`):

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

Each test runs in an isolated temp directory. The harness copies scenario files and **every skill in `plugin/skills/`** into it, then sets it as `cwd` for the Claude Agent SDK session. This reproduces how Cowork presents project files to skills — skills use `Read`, `Write`, and `Edit` tools on real files in the working directory, and Claude has the full skill registry available so it can choose which one to invoke.

```
/tmp/eval-<test-id>-<random>/
  research.json              ← copied from eval/fixtures/scenarios/<scenario>/
  tree.gedcomx.json          ← copied from eval/fixtures/scenarios/<scenario>/
  .claude/
    skills/
      assertion-classification/   ← copied from plugin/skills/
      citation/
      conflict-resolution/
      ... (all skills)
```

For stateless tests (`scenario: null`), the temp directory contains only `.claude/skills/`. For `init-project` tests, the directory starts without `research.json` or `tree.gedcomx.json` — the skill creates them.

### Why all skills, not just the one under test

Triggering correctness is a first-class evaluation target (Section 1, Section 6). A positive test must verify that Claude actually chose the skill under test from the full registry; a negative test must verify that Claude chose a *different* skill — or no skill at all — per the `negative.correct_skill` array. If only the skill under test were loaded, triggering would be trivially correct for positives and unobservable for negatives.

The harness records which skill(s) Claude invoked. The run log includes this under `output.skills_invoked` (Section 10) so positive tests can fail if the wrong skill was used, and negative tests can verify the `correct_skill` array (including the empty-array "no skill should fire" case).

### Why copy skills, not symlink

Skills are self-contained (no cross-skill file references). Copying avoids symlink management, works across platforms, and ensures full isolation when tests run in parallel. The full skill directory is small enough (combined ~1-2 MB) that copy cost is negligible. Prompt caching (Section 11) keeps the input-token cost of loading all skills low across a batched skill run.

### Claude Agent SDK configuration

```python
from claude_code_sdk import query, ClaudeAgentOptions

options = ClaudeAgentOptions(
    cwd=tmp_dir,
    setting_sources=["project"],
    allowed_tools=compute_allowed_tools(test.skill, tmp_dir),
    permission_mode="dontAsk",
    model="claude-sonnet-4-6-20250514",  # pinned model version
    temperature=0,                       # deterministic decoding within a single run
    hooks={
        "PreToolUse": [skills_invoked_hook, tool_call_hook],
    },
)

async for message in query(prompt=user_message, options=options):
    # collect results
```

Key settings:

- `cwd` — the temp directory. The SDK discovers skills from `.claude/skills/` relative to this path.
- `setting_sources=["project"]` — required for skill discovery. `"project"` loads `.claude/` from cwd. v1.5 dropped `"user"` because eval runs on developer machines where `~/.claude/skills/` may contain custom user skills that contaminate routing tests; outcomes need to be reproducible across machines and CI. Production Cowork loads both, but it runs in a fresh VM where `~/.claude/` is a known clean state.
- `allowed_tools` — **per-skill, derived from the skill's SKILL.md frontmatter** (see below). Combined with `permission_mode="dontAsk"`, this enforces the tool allowlist at execution time rather than only catching violations after the fact.
- `model` — pinned to a specific version for reproducibility across runs.
- `temperature=0` — deterministic decoding within a single run. **v1.5 implementation note:** the installed `claude-agent-sdk` does not currently expose a `temperature` field on `ClaudeAgentOptions` — the harness relies on the underlying Claude Code CLI's default decoding behaviour. Variance is acknowledged in `harness/skill_runner.py` and captured by bumping `runs_per_test` when needed.
- `hooks` — `PreToolUse` hooks let the harness observe every tool invocation, including `Skill` calls (used to populate `skills_invoked`) and MCP calls (used to populate `tool_calls` and route to the mock server).

### Deriving `allowed_tools` per skill

Cowork honors a skill's `allowed-tools` frontmatter; the Agent SDK currently does not (master testing plan, Appendix F). To match production fidelity, the harness parses each skill's SKILL.md frontmatter and constructs `allowed_tools` as the union of:

1. **Baseline filesystem tools.** Every skill needs `Read` (so it can read project files), `Glob` + `Grep` (so it can find them), and `Write` + `Edit` (so it can produce its output). These are added unconditionally — Cowork doesn't require them to be declared either, and the `research.json` ownership table isn't a clean source for "does the skill need Write/Edit": wiki-lookup writes markdown to the user's folder, tree-edit writes `tree.gedcomx.json`, neither shows up in the ownership table but both need Write/Edit. The universal `test_ownership_table` validator catches research.json misuse, and the `disallowed_tools` backstop blocks dangerous host tools (`Bash`, `WebFetch`, etc.).
2. **Declared MCP tools.** Every entry in the skill's `allowed-tools` frontmatter, qualified to its full `mcp__<server>__<tool>` form.
3. **`Skill`.** Always included so the skill-routing mechanism works.

```python
def compute_allowed_tools(skill_name: str, tmp_dir: Path) -> list[str]:
    fm = parse_frontmatter(tmp_dir / ".claude/skills" / skill_name / "SKILL.md")
    declared = [f"mcp__genealogy__{t}" if "__" not in t else t
                for t in fm.get("allowed-tools", [])]
    # Write and Edit are always in the baseline — the research.json
    # ownership table isn't a clean source for "does the skill write any
    # file" (see prose above). The universal ownership validator catches
    # research.json misuse and the disallowed-tools backstop blocks
    # dangerous host tools.
    baseline = ["Read", "Glob", "Grep", "Write", "Edit", "Skill"]
    return baseline + declared
```

A skill that calls a tool not in its derived list is rejected by the SDK at call time. The harness records the rejection as a tool_call with `matched.kind: "none"` and an error envelope, and the run typically fails the tool-allowlist validator.

### Capturing `skills_invoked` via PreToolUse

The Agent SDK fires a `PreToolUse` hook before every tool call. The harness uses it to observe `Skill` invocations:

```python
async def skills_invoked_hook(call):
    if call.tool_name == "Skill":
        skill_arg = call.tool_input.get("skill")
        if skill_arg:
            run_state.skills_invoked.append(skill_arg)
    return None  # let the call proceed
```

The same hook mechanism intercepts MCP tool calls — but those go through the in-process mock server (see below) rather than being captured here. `skills_invoked` is therefore the authoritative record of which skill(s) Claude chose, not which MCP tools fired.

### File diff algorithm

After each run, the harness compares `before_state` and `after_state` to produce the structured diff stored in the run log (Section 10). The algorithm operates per top-level array in `research.json` and `tree.gedcomx.json`:

1. **Index both states by entry `id`.** Every array (sections of `research.json`, `persons[]` / `relationships[]` / `sources[]` in `tree.gedcomx.json`) is a list of objects with an `id` field.
2. **Compute three sets:**
   - `added`: IDs in `after` but not in `before` — emit the full new object.
   - `deleted`: IDs in `before` but not in `after` — emit the full old object. Should always be empty (no-delete enforcement).
   - `common`: IDs in both — for each, compare each field. If any field differs, emit `{id, changed_fields: {<field>: {before, after}}}`. If all fields match, omit.
3. **The `project` section is a single object, not an array.** Treat it as a one-entry array keyed by `id` for purposes of diffing.
4. **Files outside `research.json` / `tree.gedcomx.json`** (e.g., a markdown file from `wiki-lookup`) are not diffed structurally — they appear in `output.files_created` with their path, and content is left to the validators or judge to interpret.

The harness does not use RFC 6902 JSON Patch. Patch operations are less readable in the UI and would require teaching the LLM judge a separate format.

### MCP fixture injection via in-process mock server

The harness creates an in-process mock MCP server using the SDK's `@tool` decorator and `create_sdk_mcp_server()`. This runs in the same Python process as the harness — no subprocess management, no stdio parsing, no serialization.

The harness builds the fixture manifest from the test's `mcp_fixtures` array. Every fixture declares a required non-empty `args` predicate (Section 3.2); dispatch is predicate-only:

```python
from claude_agent_sdk import tool, create_sdk_mcp_server

def build_fixture_manifest(fixture_names, fixtures_dir):
    """Load fixtures into {tool_name: {"predicated": [(args, response, name), ...]}}."""
    manifest = {}
    for name in fixture_names:
        fixture = json.load(open(fixtures_dir / f"{name}.json"))
        if not fixture.get("args"):
            raise InvalidFixtureError(f"fixture {name} missing required non-empty args")
        bucket = manifest.setdefault(fixture["tool"], {"predicated": []})
        bucket["predicated"].append((fixture["args"], fixture["response"], name))
    return manifest

def matches(predicate, args):
    """All dotted-path keys in predicate must match args. ~prefix = substring."""
    for path, expected in predicate.items():
        actual = args
        for part in path.removeprefix("args.").split("."):
            if not isinstance(actual, dict) or part not in actual:
                return False
            actual = actual[part]
        if isinstance(expected, str) and expected.startswith("~"):
            if expected[1:].lower() not in str(actual).lower():
                return False
        elif actual != expected:
            return False
    return True

def create_mock_server(fixture_manifest):
    tools = []
    call_log = []

    for tool_name, bucket in fixture_manifest.items():
        predicated = list(bucket["predicated"])

        @tool(tool_name, f"Mock {tool_name}", {})
        async def handler(args, _predicated=predicated, _name=tool_name):
            entry = {"tool": _name, "args": args, "expected_args": None,
                     "matched": {"kind": "none", "index": None},
                     "response_fixture": None}
            call_log.append(entry)
            for i, (predicate, response, source_name) in enumerate(_predicated):
                if matches(predicate, args):
                    entry["matched"] = {"kind": "predicate", "index": i}
                    entry["expected_args"] = dict(predicate)
                    entry["response_fixture"] = source_name
                    return response
            return {
                "error": "fixture_not_found",
                "tool": _name,
                "message": f"No fixture matched call to {_name}. Add a fixture for this argument shape.",
            }

        tools.append(handler)

    server = create_sdk_mcp_server(name="genealogy", version="1.0.0", tools=tools)
    return server, call_log
```

The `matched.kind` field in `call_log` is either `"predicate"` (a fixture matched) or `"none"` (no fixture matched — the handler returned the `fixture_not_found` envelope above). `expected_args` carries the matched fixture's `args` block so the trace view and judge prompt can render expected/actual side-by-side without re-reading the fixture file.

The SDK is configured to use the mock server:

```python
manifest = build_fixture_manifest(test_json.get("mcp_fixtures", []), fixtures_dir)
mock_server, call_log = create_mock_server(manifest)

options = ClaudeAgentOptions(
    cwd=tmp_dir,
    mcp_servers={"genealogy": mock_server},
    allowed_tools=[f"mcp__genealogy__{t}" for t in manifest],
    # ...
)
```

After the test completes, `call_log` contains every tool call (tool name + arguments) for the run log and LLM judge.

**Why in-process, not subprocess stdio:**
- **Reliability:** No subprocess to crash, hang, or fail to start. No stdio buffering issues. No race conditions on cleanup.
- **Correctness:** Fixture data is passed directly in Python — no serialization/deserialization through stdio that could alter responses. Tool call arguments captured directly, not parsed from logs.
- **Stability:** The `@tool` + `create_sdk_mcp_server()` API is a first-class SDK feature, not a workaround.
- **Simplicity:** No fixture manifest files on disk, no subprocess lifecycle management.

We're testing whether the *skill* behaves correctly, not whether the MCP protocol works. The real MCP server has its own Vitest tests for protocol correctness.

**Tool naming:** The SDK names in-process tools as `mcp__<server-name>__<tool-name>`. With `name="genealogy"`, a tool registered as `wikipedia_search` becomes `mcp__genealogy__wikipedia_search` — matching the naming pattern skills expect.

**Multi-call handling:** If `mcp_fixtures` lists multiple fixture files for the same tool (same `tool` field in the fixture JSON), the mock queues them and returns them in order for successive calls. If only one fixture exists for a tool called multiple times, the same response is returned each time.

### Parallel execution

Tests are independent — each has its own temp directory, its own in-process mock MCP server instance, and its own SDK session. Run them concurrently with `asyncio.gather`:

```python
async def run_all_tests(tests):
    tasks = [run_single_test(t) for t in tests]
    results = await asyncio.gather(*tasks, return_exceptions=True)
```

Each test instantiates its own mock server (no subprocess; just a Python object). No shared state, no conflicts.

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

### Execution limits

Every test runs under hard limits. Exceeding any one aborts the run with `outcome: aborted`; the judge is skipped and the run is logged with the breached limit named. Aborted runs do not count toward pass-rate metrics but are tracked as a stability signal.

| Limit | Default | Override field | Why |
|-------|---------|---------------|-----|
| `max_turns` | 20 | `execution.max_turns` | Bounds agent loops. Most single-turn skills resolve in 3-8 turns; 20 is a generous ceiling that still catches runaway loops |
| `max_wall_clock_seconds` | 300 | `execution.max_wall_clock_seconds` | Catches hangs and excessively slow responses. 5 min handles even complex synthesis skills |
| `max_tool_calls` | 50 | `execution.max_tool_calls` | Bounds MCP fixture consumption and prevents accidental fan-out (e.g., a skill that calls `place_search` for every word in the user message) |
| `max_input_tokens_per_turn` | 200000 | `execution.max_input_tokens_per_turn` | Catches scenarios where the skill re-reads files into context until the window saturates. **Post-hoc**: the SDK exposes `usage.input_tokens` only after a turn returns, so the offending turn is billed before the harness aborts. Catches runaway *growth* between turns, not the first oversized turn. A preemptive cap requires a `PreSendMessage` hook with token estimation; deferred to v2 |

Test JSON may override per-test (rare — mostly used for `proof-conclusion` and `research-plan`, which legitimately take more turns):

```json
{
  "execution": {
    "max_turns": 40,
    "max_wall_clock_seconds": 600
  }
}
```

Schema-level: `execution` is an optional object on the top-level test schema (Section 4) with all four fields optional.

The harness also enforces a **suite-level budget**: a wall-clock cap and a USD spend cap on the whole run. Exceeding either pauses the queue and surfaces the abort to the operator. Defaults: 4 hours, $50 — overridable via the harness CLI.

### Known risks

- **Skill discovery on Linux:** The testing plan flags issue #268 — hardcoded macOS paths in the SDK's skill discovery. Verify that `.claude/skills/<name>/SKILL.md` is found correctly on Linux before trusting results.
- **Session storage pollution:** Temp directories create orphaned session entries in `~/.claude/projects/`. The harness must clean these up or the directory will grow unboundedly.
- **`permission_mode="dontAsk"` must actually block unlisted tools.** The harness relies on this SDK setting to enforce per-skill allowlists at call time (see "Deriving `allowed_tools` per skill"). Verify on every SDK version bump that an unlisted tool is rejected rather than silently prompting. If the SDK regresses, fall back to `disallowed_tools` populated as the complement of the per-skill allowlist.
- **Hook API stability:** The PreToolUse hook interface may change between SDK versions. Pin the SDK version in `eval/harness/pyproject.toml`.

---

## 16. Reference Examples

The following seed files exist in the repo as working references for harness development. Each category has at least one example demonstrating the expected format and conventions.

### Scenarios

Two scenarios are shipped today: `mid-research-flynn` and `flynn-with-birthplace-conflict` (both under `eval/fixtures/scenarios/`). The full list of bootstrap scenarios devs must seed for Phase 1 — including which are still needed — lives in [`docs/gps/skill-mcp-testing-plan.md`](../gps/skill-mcp-testing-plan.md) under "Sequencing > Phase 1." That's the single source of truth for scenario inventory and priority; this section links rather than restates to prevent drift.

Each scenario directory contains `research.json`, `tree.gedcomx.json`, and `README.md`. The two JSON files must validate against [`research.schema.json`](schemas/research.schema.json) and [`tree-gedcomx.schema.json`](schemas/tree-gedcomx.schema.json).

### MCP Fixtures

Eight fixtures in `eval/fixtures/mcp/`:

| Fixture | Tool | Used by |
|---------|------|---------|
| `wikipedia-search-schuylkill-county.json` | `wikipedia_search` | wiki-lookup |
| `wiki-search-irish-immigration.json` | `wiki_search` | historical-context |
| `place-search-schuylkill-county.json` | `place_search` | locality-guide, research-plan, timeline |
| `record-search-1850-census-flynn.json` | `record_search` | search-records |
| `fulltext-search-flynn-witnesses.json` | `fulltext_search` | search-full-text |
| `place-external-links-schuylkill.json` | `place_external_links` | search-external-sites |
| `place-collections-schuylkill.json` | `place_collections` | locality-guide, research-plan |
| `tree-read-flynn.json` | `tree_read` | init-project |

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
