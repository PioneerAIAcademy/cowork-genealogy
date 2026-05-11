# Example Unit Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the first example unit test (conflict-resolution skill), its scenario fixture, its skill rubric, and update eval/CLAUDE.md to reference the specs.

**Architecture:** Create a scenario fixture from the Patrick Flynn worked example in research-schema-spec.md, write a conflict-resolution rubric, write one example unit test JSON file, and update the eval CLAUDE.md. No code — just JSON files, markdown, and directory structure.

**Tech Stack:** JSON, Markdown

---

### Task 1: Create the fixtures directory structure

**Files:**
- Create: `eval/fixtures/scenarios/.gitkeep`
- Create: `eval/fixtures/mcp/.gitkeep`

- [ ] **Step 1: Create fixture directories**

```bash
mkdir -p eval/fixtures/scenarios eval/fixtures/mcp
touch eval/fixtures/scenarios/.gitkeep eval/fixtures/mcp/.gitkeep
```

- [ ] **Step 2: Verify**

```bash
ls eval/fixtures/
```

Expected: `mcp/` and `scenarios/` directories.

- [ ] **Step 3: Commit**

```bash
git add eval/fixtures/
git commit -m "feat(eval): add fixtures directory structure for scenarios and MCP mocks"
```

---

### Task 2: Create the mid-research-flynn scenario fixture

This scenario provides the base Patrick Flynn research state from the worked example in `docs/specs/research-schema-spec.md` Section 9. It represents mid-project: 1850 census searched, Thomas Flynn identified as candidate father, no conflicts yet.

**Files:**
- Create: `eval/fixtures/scenarios/mid-research-flynn/research.json`
- Create: `eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json`
- Create: `eval/fixtures/scenarios/mid-research-flynn/README.md`

- [ ] **Step 1: Create the scenario directory**

```bash
mkdir -p eval/fixtures/scenarios/mid-research-flynn
```

- [ ] **Step 2: Write the README**

Create `eval/fixtures/scenarios/mid-research-flynn/README.md`:

```markdown
# mid-research-flynn

Patrick Flynn parentage research, mid-project.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** q_001 (parentage, in_progress), q_002 (1850 census placement, resolved)
- **Plans:** pl_001 (1850 census search, completed), pl_002 (parentage evidence, active)
- **Log:** 5 entries — 1850 census on FamilySearch/Ancestry/MyHeritage, 1860 census, death cert
- **Sources:** 4 sources (1850 census FS, 1850 census Ancestry, 1860 census, death cert)
- **Assertions:** 13 assertions across 4 sources
- **Person evidence:** 6 links (Patrick → I1, Thomas → I2)
- **Conflicts:** none yet
- **Hypotheses:** h_001 (Thomas is Patrick's father, supported)
- **Timelines:** t_001 (Patrick, 4 events, 1 gap)
- **Proof summaries:** ps_001 (parentage, probable)
- **GedcomX persons:** I1 (Patrick Flynn), I2 (Thomas Flynn)
- **GedcomX relationships:** R1 (ParentChild, Thomas → Patrick)
```

- [ ] **Step 3: Write tree.gedcomx.json**

Create `eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json`. Copy the exact GedcomX from `docs/specs/research-schema-spec.md` Section 9 (the `tree.gedcomx.json` block starting at "### `tree.gedcomx.json` (simplified GedcomX, abbreviated)").

The content is the full Patrick Flynn GedcomX with persons I1 (Patrick) and I2 (Thomas), relationship R1 (ParentChild), and sources S1-S4.

- [ ] **Step 4: Write research.json**

Create `eval/fixtures/scenarios/mid-research-flynn/research.json`. Copy the exact research.json from `docs/specs/research-schema-spec.md` Section 9 (the `research.json` block).

The content is the full Patrick Flynn research state with all 11 sections populated as shown in the worked example.

- [ ] **Step 5: Verify both files are valid JSON**

```bash
python3 -c "import json; json.load(open('eval/fixtures/scenarios/mid-research-flynn/research.json')); print('research.json OK')"
python3 -c "import json; json.load(open('eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json')); print('tree.gedcomx.json OK')"
```

Expected: Both print OK.

- [ ] **Step 6: Commit**

```bash
git add eval/fixtures/scenarios/mid-research-flynn/
git commit -m "feat(eval): add mid-research-flynn scenario fixture from research schema worked example"
```

---

### Task 3: Create the flynn-with-birthplace-conflict scenario fixture

This scenario extends mid-research-flynn by adding the birthplace conflict (c_001) from the worked example. This is the scenario used by the conflict-resolution example test.

In the mid-research-flynn scenario, the conflicts array already contains c_001 (birthplace: Ireland vs Pennsylvania, status: resolved). For our test, we need a variant where the conflict exists but is **unresolved** — that's what the conflict-resolution skill should produce.

**Files:**
- Create: `eval/fixtures/scenarios/flynn-with-birthplace-conflict/research.json`
- Create: `eval/fixtures/scenarios/flynn-with-birthplace-conflict/tree.gedcomx.json`
- Create: `eval/fixtures/scenarios/flynn-with-birthplace-conflict/README.md`

- [ ] **Step 1: Create the scenario directory**

```bash
mkdir -p eval/fixtures/scenarios/flynn-with-birthplace-conflict
```

- [ ] **Step 2: Write the README**

Create `eval/fixtures/scenarios/flynn-with-birthplace-conflict/README.md`:

```markdown
# flynn-with-birthplace-conflict

Patrick Flynn parentage research. Same as mid-research-flynn but the
birthplace conflict (Ireland vs Pennsylvania) has NOT been resolved yet.

- **Conflicts:** c_001 exists with `status: "unresolved"`, no `preferred_assertion_id`,
  no `resolution_rationale`, no `independence_analysis`, no `weighing_analysis`
- **Assertions:** a_002 (1850 census: Ireland), a_009 (1860 census: Ireland),
  a_012 (death cert: Pennsylvania) — the three competing assertions
- **Everything else:** Same as mid-research-flynn

Use this scenario for conflict-resolution tests where the skill should
identify and resolve the birthplace discrepancy.
```

- [ ] **Step 3: Copy tree.gedcomx.json from mid-research-flynn**

```bash
cp eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json eval/fixtures/scenarios/flynn-with-birthplace-conflict/tree.gedcomx.json
```

The GedcomX is identical — conflicts live in research.json, not the GedcomX file.

- [ ] **Step 4: Create research.json with unresolved conflict**

Create `eval/fixtures/scenarios/flynn-with-birthplace-conflict/research.json`. Start from the mid-research-flynn research.json but modify the `conflicts` array. Replace the resolved conflict with an unresolved stub:

The `conflicts` array should contain:

```json
"conflicts": [
  {
    "id": "c_001",
    "conflict_type": "fact",
    "description": "Patrick Flynn's birthplace: Ireland (1850 and 1860 censuses) vs. Pennsylvania (1908 death certificate)",
    "disputed_attribute": "birthplace",
    "identity_question": null,
    "competing_assertion_ids": ["a_002", "a_009", "a_012"],
    "independence_analysis": null,
    "weighing_analysis": null,
    "preferred_assertion_id": null,
    "resolution_rationale": null,
    "status": "unresolved",
    "blocks_question_ids": ["q_001"]
  }
]
```

All other sections (project, questions, plans, log, sources, assertions, person_evidence, hypotheses, timelines, proof_summaries) remain identical to mid-research-flynn.

- [ ] **Step 5: Verify the JSON is valid**

```bash
python3 -c "import json; json.load(open('eval/fixtures/scenarios/flynn-with-birthplace-conflict/research.json')); print('OK')"
```

Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add eval/fixtures/scenarios/flynn-with-birthplace-conflict/
git commit -m "feat(eval): add flynn-with-birthplace-conflict scenario (unresolved birthplace conflict)"
```

---

### Task 4: Create the conflict-resolution skill rubric

**Files:**
- Create: `eval/tests/unit/conflict-resolution/rubric.md`

- [ ] **Step 1: Write the rubric**

Create `eval/tests/unit/conflict-resolution/rubric.md`:

```markdown
# Conflict Resolution Rubric

Grading dimensions for all conflict-resolution unit tests. These are evaluated by the LLM judge in addition to the base rubric (correctness, completeness).

## Dimensions

### Source independence analysis
Did the skill assess whether competing sources are truly independent? Two derivative indexes of the same original are not independent. Two census records with different enumerators but the same household informant may not be fully independent for the facts that informant reported. The analysis must be specific to the conflict's fact type, not a generic statement about the sources.

### Evidence weighing
Did the skill apply the GPS preponderance hierarchy? Original sources outweigh derivative. Primary information outweighs secondary. Contemporary recordings outweigh later recollections. Direct evidence outweighs indirect. The weighing must cite specific attributes of the competing assertions (informant proximity, temporal distance, source classification), not just state the hierarchy abstractly.

### Resolution completeness
Did the resolution address ALL competing assertions, not just the two most obvious? A conflict with three competing assertions requires explaining why each non-preferred assertion is less reliable, not just why the preferred one is best. The resolution rationale must be specific enough that a reviewer can understand the reasoning without reading the full assertion details.
```

- [ ] **Step 2: Remove the .gitkeep (it's no longer needed)**

```bash
rm eval/tests/unit/conflict-resolution/.gitkeep
```

- [ ] **Step 3: Commit**

```bash
git add eval/tests/unit/conflict-resolution/rubric.md
git rm --cached eval/tests/unit/conflict-resolution/.gitkeep 2>/dev/null; true
git commit -m "feat(eval): add conflict-resolution skill rubric"
```

---

### Task 5: Create the example unit test

**Files:**
- Create: `eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json`

- [ ] **Step 1: Write the test file**

Create `eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json`:

```json
{
  "test": {
    "id": "ut_conflict_resolution_001",
    "skill": "conflict-resolution",
    "name": "Resolve birthplace conflict via informant proximity and temporal distance",
    "type": "positive",
    "description": "Three sources disagree on birthplace. Two contemporary census records (1850, 1860) say Ireland, one later death certificate (1908) says Pennsylvania. Tests whether the skill weighs informant proximity and temporal distance correctly per the GPS preponderance hierarchy.",
    "tags": ["birthplace", "informant-weighting", "census-vs-vital", "fact-conflict", "three-source"]
  },

  "input": {
    "user_message": "Check for conflicts in Patrick Flynn's evidence and resolve any you find.",
    "scenario": "flynn-with-birthplace-conflict"
  },

  "additional_criteria": [
    "Should note that the two census informants may be the same household member (likely Thomas Flynn or wife), which weakens their independence for this specific fact even though the sources themselves are independent",
    "Resolution should cite both informant proximity (household_member vs family_not_present) and temporal distance (contemporary 1850/1860 recordings vs 63-year-later 1908 recollection) as factors favoring the census assertions",
    "Should identify the son-in-law James Brown as a secondary informant for birth facts on the death certificate — he was not present at Patrick's birth and is reporting what he was told",
    "Should set preferred_assertion_id to a_002 (or a_009 — both say Ireland) and status to resolved"
  ]
}
```

- [ ] **Step 2: Validate the test JSON against the schema**

```bash
python3 -c "
import json
test = json.load(open('eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json'))
assert test['test']['id'].startswith('ut_'), 'ID must start with ut_'
assert test['test']['type'] in ('positive', 'negative'), 'type must be positive or negative'
assert isinstance(test['additional_criteria'], list), 'additional_criteria must be array'
assert test['input']['user_message'], 'user_message required'
print('Schema validation passed')
"
```

Expected: Schema validation passed.

- [ ] **Step 3: Commit**

```bash
git add eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json
git commit -m "feat(eval): add first example unit test — conflict-resolution birthplace conflict"
```

---

### Task 6: Update eval/CLAUDE.md

**Files:**
- Modify: `eval/CLAUDE.md`

- [ ] **Step 1: Update the directory layout to include fixtures**

In the directory layout section at the top, add `fixtures/` to the tree:

```
eval/
  CLAUDE.md              This file
  Setup.bat              One-time setup (uv, npm, API key)
  Start.bat              Launch the Next.js test-creation/annotation app
  RunTests.bat          Execute the Python test harness
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

- [ ] **Step 2: Update the "What Belongs Where" section**

Add entries for fixtures and harness/validators:

```markdown
- **`fixtures/scenarios/`** — Shared project state fixtures. Each
  scenario is a directory with `research.json`, `tree.gedcomx.json`,
  and `README.md`. Tests reference scenarios by directory name.
- **`fixtures/mcp/`** — Mocked MCP tool response fixtures. Each
  fixture is a single JSON file with `tool`, `description`, and
  `response` fields. Tests reference fixtures by filename.
- **`harness/validators/`** — Developer-written Python validators
  (one `test_*.py` file per skill). Run automatically by the harness
  after each test execution.
```

- [ ] **Step 3: Update the "Test files" naming section**

Replace the "Format: JSON (schema TBD)" line with a reference to the specs:

```markdown
Test definitions live in `tests/unit/<skill-name>/` and
`tests/e2e/`. Format defined in `docs/specs/unit-test-spec.md`
and `docs/specs/e2e-test-format-spec.md`.
```

- [ ] **Step 4: Update the run log path convention**

The current CLAUDE.md shows run log paths without the model version directory. Update to match the specs:

```
runlogs/unit/locality-guide/<model-version>/
  2026-05-10-14-30-00.json
```

- [ ] **Step 5: Commit**

```bash
git add eval/CLAUDE.md
git commit -m "docs(eval): update CLAUDE.md with fixtures, validators, and spec references"
```

---

### Task 7: Final verification

- [ ] **Step 1: Verify the complete directory structure**

```bash
find eval -type f | sort
```

Expected output should include:
```
eval/CLAUDE.md
eval/RunTests.bat
eval/Setup.bat
eval/Start.bat
eval/fixtures/mcp/.gitkeep
eval/fixtures/scenarios/flynn-with-birthplace-conflict/README.md
eval/fixtures/scenarios/flynn-with-birthplace-conflict/research.json
eval/fixtures/scenarios/flynn-with-birthplace-conflict/tree.gedcomx.json
eval/fixtures/scenarios/mid-research-flynn/README.md
eval/fixtures/scenarios/mid-research-flynn/research.json
eval/fixtures/scenarios/mid-research-flynn/tree.gedcomx.json
eval/tests/unit/conflict-resolution/birthplace-ireland-vs-pennsylvania.json
eval/tests/unit/conflict-resolution/rubric.md
```

Plus all the existing .gitkeep files in other skill directories.

- [ ] **Step 2: Verify all JSON files parse**

```bash
find eval -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

Expected: All files print OK.

- [ ] **Step 3: Commit any remaining changes**

```bash
git status
```

If clean, no action needed. If any unstaged changes remain, stage and commit.
