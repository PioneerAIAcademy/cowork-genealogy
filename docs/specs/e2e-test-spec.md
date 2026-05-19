# E2E Test Format Specification

**Project:** Cowork Genealogy — an AI genealogy research assistant
**Scope:** End-to-end evaluation tests derived from published GPS-compliant proof statements

---

## 1. Overview

Each e2e test exercises the full GPS research pipeline: project initialization, question selection, research planning, record search, extraction, classification, person-evidence linking, conflict resolution, and proof conclusion. Tests make real API calls against live FamilySearch endpoints.

Every e2e test maps to a published GPS-compliant proof statement (journal article, case study, or textbook example). The published proof provides the ground truth: what records exist, what conclusion is correct, and how the evidence should be weighed.

### What the test file contains

- The starting state (a GedcomX stub and research objective)
- The expected ending state (a completed GedcomX with resolved persons and relationships)
- URLs of records the pipeline should find
- The expected conclusion and proof tier
- Conflicts the pipeline should identify and resolve
- Case-specific grading dimensions (in addition to the base rubric)
- A reference to the published proof narrative file (for genealogist reference)

### What the test file does not contain

- Record content (fetched at runtime via real API calls)
- The exact `research.json` output (too brittle; graded by rubric instead)
- Mock data or fixtures (e2e tests are live)

---

## 2. File Location and Naming

Each e2e test gets its own directory under `eval/tests/e2e/`, named by a short kebab-case slug describing the research problem:

```
eval/tests/e2e/flynn-parentage/
  test.json                         # The test definition
  reference-narrative.md            # Published proof narrative (for genealogist reference)
eval/tests/e2e/smith-migration-virginia-ohio/
  test.json
  reference-narrative.md
```

---

## 3. Schema

```json
{
  "test": {
    "id": "string (unique, e2e_ prefix)",
    "name": "string (short human-readable name)",
    "source_url": "string (URL to the published proof statement)",
    "source_citation": "string (formatted citation of the published source)",
    "description": "string (1-2 sentence summary of the research problem)"
  },

  "input": {
    "objective": "string (the research objective, passed to init-project)",
    "initial_gedcomx": "object (simplified GedcomX per simplified-gedcomx-spec.md)"
  },

  "expected_records": [
    {
      "id": "string (local ID, rec_ prefix, scoped to this test file)",
      "description": "string (what this record is and why it matters)",
      "url": "string (URL to the record, e.g. FamilySearch ARK)"
    }
  ],

  "expected_gedcomx": "object (simplified GedcomX representing the correct final state)",

  "expected_conclusion": {
    "answer": "string (the correct answer to the research question)",
    "expected_tier": "string (proof_tier enum: proved, probable, possible, not_proved, disproved)",
    "tier_rationale": "string (why this tier, not higher or lower)"
  },

  "expected_conflicts": [
    {
      "description": "string (what the conflict is)",
      "expected_resolution": "string (how it should be resolved and why)"
    }
  ],

  "additional_dimensions": [
    "string (case-specific grading criteria beyond the base rubric)"
  ],

  "reference_narrative_file": "string (filename of the published proof narrative markdown, relative to this test's directory)"
}
```

All top-level fields are required. `expected_records`, `expected_conflicts`, and `additional_dimensions` may be empty arrays but must be present.

---

## 4. Field Details

### 4.1 `test`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique test ID with `e2e_` prefix (e.g., `e2e_flynn_parentage`) |
| `name` | string | yes | Short human-readable name |
| `source_url` | string | yes | URL to the published GPS proof statement |
| `source_citation` | string | yes | Formatted citation of the published source |
| `description` | string | yes | 1-2 sentence summary of the research problem |

### 4.2 `input`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `objective` | string | yes | Research objective passed to the `init-project` skill |
| `initial_gedcomx` | object | yes | Simplified GedcomX stub representing what is known before research begins. Must conform to `simplified-gedcomx-spec.md`. Typically contains one stub person with a name and whatever facts are given (approximate birth, known death, etc.) |

### 4.3 `expected_records`

Array of records the pipeline should discover during research. Each entry is a record that exists in a live repository and is findable via the MCP search tools.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Local ID (`rec_` prefix), scoped to this test file. Used in grading reports to reference specific records |
| `description` | string | yes | What this record is and why it matters to the proof |
| `url` | string | yes | Direct URL to the record (e.g., FamilySearch ARK). The harness compares found record URLs against these |

**Grading:** The harness computes recall (what fraction of expected records were found) and may flag unexpected records found (for genealogist review, not automatic penalty).

### 4.4 `expected_gedcomx`

The correct final state of `tree.gedcomx.json` after research is complete. Conforms to `simplified-gedcomx-spec.md`.

**Deterministic grading compares:**
- Persons: were the correct persons identified? (match by name, not by ID)
- Relationships: were the correct relationships established? (match by type + person names)
- Facts: were the correct facts recorded with correct values? (match by type + value, tolerating date format differences like `~1845` vs `approximately 1845`)
- Sources: were the correct sources cited? (match by title or URL)

The comparison is semantic, not structural. IDs will differ. Date formats may differ. The grading checks whether the same genealogical conclusions were reached, not whether the JSON is identical.

### 4.5 `expected_conclusion`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `answer` | string | yes | The correct answer to the research question, stated plainly |
| `expected_tier` | string | yes | The correct `proof_tier` value: `proved`, `probable`, `possible`, `not_proved`, or `disproved` |
| `tier_rationale` | string | yes | Why this tier is correct. Used by the LLM judge to evaluate whether Claude's tier assignment is defensible |

### 4.6 `expected_conflicts`

Array of evidence conflicts the pipeline should identify and resolve. May be empty if the proof has no conflicts.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | What the conflict is (e.g., "Birthplace: Ireland vs Pennsylvania") |
| `expected_resolution` | string | yes | How the conflict should be resolved, with GPS reasoning |

**Grading:** The LLM judge compares actual conflicts identified against these. Deterministic check: were conflicts identified at all? LLM judge: was the resolution reasoning sound?

### 4.7 `additional_dimensions`

Array of case-specific grading criteria that go beyond the base rubric. These capture GPS reasoning that only applies to this particular proof.

Examples:
- "Did Claude recognize that the 1850 census lacks a relationship column and classify the parent-child inference as indirect evidence?"
- "Did Claude identify that the two census informants may be the same household member, weakening their independence?"

These are graded by the LLM judge alongside the base rubric dimensions.

### 4.8 `reference_narrative_file`

Filename of a markdown file containing the full proof narrative from the published source, relative to the test directory (typically `reference-narrative.md`). Stored as a separate file because proof narratives can be thousands of words and are unreadable as inline JSON strings.

Included so genealogists reviewing test results can compare Claude's output against the published standard. **Not used for automated grading** — the published proof has a different voice, structure, and citation style than what the pipeline produces. If narrative quality grading is added later, it should judge the pipeline's narrative on its own merits, not by similarity to the source.

---

## 5. Base Rubric

The following dimensions are graded for every e2e test. They are defined here, not in each test file, so they can be aggregated and trended across all e2e tests. The grading prompt optimizer targets this rubric.

| Dimension | What the LLM judge evaluates |
|-----------|------------------------------|
| Research plan quality | Did the plan target appropriate record types, jurisdictions, and date ranges for the research question? Were fallback strategies included? |
| Evidence classification accuracy | Were sources correctly classified (original/derivative/authored), information quality assessed at the assertion level (primary/secondary/indeterminate), and evidence types assigned correctly (direct/indirect/negative)? |
| Person-evidence linking discipline | Did the pipeline use the `person_evidence` linking step rather than attaching assertions directly to persons? Were confidence levels appropriate? |
| Conflict handling | Were all evidence conflicts identified? Were near-conflicts correctly distinguished from true conflicts? Was the resolution reasoning sound, addressing source independence and evidence weighing as separate steps? If no conflicts exist, did the pipeline correctly refrain from fabricating any? |
| Exhaustive search declaration | Was the exhaustive search claim justified by the log? Were the 7-point stop criteria addressed? |
| Proof narrative completeness | Does the narrative cite all relevant sources, explain the evidence weighing, declare the confidence tier, and stand alone as a readable document? |

Six dimensions keeps the LLM judge reliable. If future data shows one dimension has high variance and covers genuinely independent failure modes, it can be split — but only by retiring or merging another dimension to stay at the cap.

---

## 6. Grading Layers

Each e2e test run is graded in three layers, matching the eval framework's general approach:

### Layer 1: Deterministic checks (automated, no LLM)

- **Record recall:** fraction of `expected_records` URLs found in the search log
- **GedcomX diff:** semantic comparison of actual vs `expected_gedcomx` (persons, relationships, facts, sources)
- **Conclusion tier match:** does the actual proof tier match `expected_tier`?
- **Conflict count:** were at least as many conflicts identified as listed in `expected_conflicts`?

### Layer 2: LLM judge (automated, uses rubric)

- Scores each base rubric dimension (Section 5)
- Scores each `additional_dimensions` entry
- Compares `expected_conflicts[].expected_resolution` to actual resolution rationale
- Compares `expected_conclusion.tier_rationale` to actual tier justification

### Layer 3: Human verification (junior + senior genealogists)

- Juniors verify LLM judge scores (agree/disagree + escalation taxonomy)
- Seniors adjudicate when juniors disagree
- Uses the annotation/adjudication file convention defined in `eval/CLAUDE.md`

---

## 7. Run Log Format

When the harness executes an e2e test, it writes a run log to:

```
eval/runlogs/e2e/<test-slug>/<model-version>/YYYY-MM-DD_HH-MM-SS.json
```

Including the model version in the path makes it trivial to compare runs across model versions.

The run log contains:
- Test ID and timestamp
- Model version used
- The complete `research.json` produced by the pipeline
- The complete `tree.gedcomx.json` produced by the pipeline
- Layer 1 deterministic check results (record recall, GedcomX diff, tier match)
- Layer 2 LLM judge scores per dimension
- Total API cost and token usage
- Wall-clock duration

Schema TBD -- will be defined when the harness is built.

---

## 8. Cost Estimate

A full pipeline run (init → plan → search → extract → classify → link → resolve → conclude) involves many LLM turns and multiple live MCP calls. Estimated cost: **$5-20 per test** depending on research complexity and number of records.

With 20+ e2e tests, a full suite run costs **$100-400**. E2e tests should run sparingly — only after unit tests are performing well (Phase 4 in the testing plan). Do not use e2e tests for iterative skill development; that's what unit tests are for.

---

## 9. Test Authoring Workflow

Creating e2e tests requires both GPS expertise and structured data. The workflow:

1. **AI generates the initial test file** from a freely-available published GPS proof statement. The AI reads the proof, extracts the research question, identifies records cited, builds the initial/expected GedcomX stubs, and populates the JSON structure.
2. **Senior genealogist reviews and corrects** using the eval UI. The AI will get genealogical nuances wrong — classification of evidence types, the precise reasoning behind conflict resolution, which records are truly critical vs. supporting. The genealogist fixes these.
3. **Dev validates** that the JSON is well-formed, expected record URLs resolve, and the test runs through the harness without structural errors.

This keeps each person in their area of expertise: AI does the tedious format conversion, genealogists ensure correctness, devs ensure it runs.

---

## 10. Worked Example

See the Patrick Flynn parentage test in the design discussion. A complete example test file will be committed to `eval/tests/e2e/` when the first published GPS proof is converted to a test case.

---

## 11. Relationship to Unit Tests

E2e tests and skill unit tests are complementary:

- **Unit tests** (`eval/tests/unit/<skill>/`) test individual skills in isolation: given a specific research state, does the skill produce correct output?
- **E2e tests** (`eval/tests/e2e/`) test the full pipeline: given a research objective, does the system find the right records, reason correctly, and reach the right conclusion?

E2e tests are more expensive to run (real API calls, full pipeline) and slower to grade (more dimensions, more complex output). Unit tests are cheaper and faster. The expected workflow: iterate on unit tests until skills are performing well, then validate with e2e tests. Per the testing plan, e2e tests are Phase 4 — do not start them until unit tests are passing reasonably well (Phases 1-3).

---

## 12. Variance from Live APIs

E2e tests make real API calls against live FamilySearch endpoints. This means test scores will have some uncontrolled variance:

- FamilySearch re-indexes records — a record findable today may not be findable next month, or new records may appear
- Record URLs (ARKs) are generally persistent but occasionally change
- Search ranking may shift, causing the pipeline to find records in a different order

**This variance is accepted as a tradeoff for testing against real data.** The alternative (mocked fixtures) would hide real-world failures that matter most. When a test score drops unexpectedly, investigate whether it's a code regression or a data change before acting.

### Mitigations

- **Record URL stability:** `expected_records` uses FamilySearch ARKs as the primary identifier. If ARK instability becomes a recurring issue, add an `alt_match` field (collection ID + key fields) for fallback matching. Don't build this until needed.
- **Partial credit:** If Claude finds the same record via a different URL (e.g., Ancestry instead of FamilySearch), it does not count as a match in deterministic scoring. The LLM judge may give credit in the research plan quality dimension. This is intentional — the pipeline is designed to search FamilySearch.
- **Test maintenance:** Periodically validate that expected records are still discoverable. When a test becomes unfixably broken due to data changes (not code changes), retire it and note why.
