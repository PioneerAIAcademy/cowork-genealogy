# Deep-Dive Brief — `validate-schema`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Almost entirely mechanics — systematically mapping `validator.ts` checks to tests. The genealogist's main role is sanity-checking that validation error messages read clearly to a researcher.
**Files:** SKILL.md (97 lines) · no references/templates · tests ×3 · rubric ✗ (**missing**).

## What this skill does
Calls the single `validate_research_schema` MCP tool against the project, then presents results — it never fixes anything. The validator checks `research.json` (required sections, `rp_`/13 ID-prefix namespaces, 20+ closed enums, assertion→source/log cross-references, plan→question refs, conflict conditional rules, hypothesis/exhaustive-declaration consistency, sidecar integrity) and `tree.gedcomx.json` (required fields, PascalCase fact types, relationship shapes, source-ref resolution), plus cross-file checks (every `gedcomx_source_description_id` and `person_id` resolves). On error: show, explain, suggest a fix. On pass: "Both project files are valid."

## Where everything lives
- `plugin/skills/validate-schema/SKILL.md` (no references/ or templates/)
- Validator implementation: `packages/engine/mcp-server/src/validation/validator.ts` (**the source of truth for what to test** — enumerate its checks)
- `eval/tests/unit/validate-schema/` — `validate-mid-research-state.json`, `validate-multi-conflict-state.json`, `negative-check-warnings.json` — **no rubric.md**
- Scenarios: `mid-research-flynn`, `flynn-multi-conflict` (both valid by design)

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_…_001 | Clean mid-research files → no errors (false-positive avoidance: nulls, empty arrays, open enums) | positive |
| ut_…_002 | Two unresolved conflicts of different shapes both validate | positive |
| ut_…_003 | "Are the dates logically inconsistent?" → routes to `check-warnings` | negative |

> **Coverage is inverted, exactly like `check-warnings`:** all three tests expect a *clean pass* or route away. **No test makes the validator actually emit an error** — so the skill's headline behavior (show errors, explain, suggest fixes, never silently fix) is entirely untested. This is the #1 gap.

## Gaps — new tests to add (one per error class in `validator.ts`)
Each needs a **deliberately-broken** scenario:
- **Missing required field** — omit a required top-level section or a required `questions[]` field.
- **Invalid enum** — `information_quality:"tertiary"`, `conflict_type:"date"`, `proof_tier:"proven"`.
- **Wrong ID prefix** — `id:"q_001"` in an assertion slot, or a prefix-less source id.
- **Broken cross-reference** — assertion `source_id` → nonexistent source; or a `gedcomx_source_description_id` absent from tree.gedcomx.json (the most complex, entirely-uncovered category).
- **Sidecar integrity** — `results_ref` → missing file, or `returned_count` ≠ actual length, or an orphan sidecar.
- **Clean `evaluations[]` pass** — neither positive test exercises `validateEvaluations` (`ev_` prefix, enums, `target_id`/`superseded_by` refs); add a valid-evaluations false-positive guard.

**Negative (boundaries):**
- → `check-warnings`: "Some birth/death dates look inconsistent — any problems?" (schema-valid but chronologically impossible).
- → `proof-conclusion`: "My proof summary is done — does the argument meet the GPS?" (GPS quality isn't a schema property).

## ⚠️ Known issues
- **No `rubric.md`** — add skill-specific dimensions like "Error explanation quality" and "Fix-suggestion specificity".
- **SKILL.md omits two whole validator areas** — the `validateSidecars` branch (~14% of validator.ts) and the `validateEvaluations` section are not in the "what the validator checks" list, so the model has no guidance on explaining those errors.
- **Mechanical to enumerate:** validator.ts has 13 ID-prefix checks, 20 enums, 3 cross-file checks, 5 sidecar sub-checks — a (check-category × test) matrix maps straight from the source, so gap-filling can be systematic rather than guesswork.

## Fixture work — the dominant cost
Every error-class test needs its **own** deliberately-broken scenario (unlike content tests, a valid scenario can't be reused to fire a specific check). Minimize overhead with a `mid-research-flynn`-derived family: `…-bad-enum`, `…-dangling-ref`, `…-bad-id-prefix`, `…-missing-field`, `…-bad-sidecar`. Build each as a minimal mutation of the known-good base so only the targeted check fires.

## Definition of done
Author `rubric.md` → add the sidecar + evaluations sections to SKILL.md → build the broken-scenario family → add one error-emitting test per error class (cover the show-errors-and-suggest-fixes path) + the clean-evaluations guard → add the `proof-conclusion` negative → full harness pass + CRUD review + PR.
