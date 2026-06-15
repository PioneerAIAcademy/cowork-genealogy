# Deep-Dive Brief — `assertion-classification`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Genealogical-judgment-heavy, fixture-light. The substance is GPS three-layer taxonomy craft — informant proximity, Primary/Secondary/Indeterminate, Direct/Indirect/Negative. Mechanics are near-zero: one `validate_research_schema` call, no MCP fixtures. New tests are project-state SCENARIOS, not mock responses.
**Files:** SKILL.md (243 lines) · references ×2 (309 lines) · tests ×3 · rubric ✓ (27 lines).

## What this skill does
GPS Step 3 (Analysis and Correlation). Refines the three-layer evidence classification on assertions that **already exist** in `research.json` — `record-extraction` writes best-effort classifications plus the Layer-1 source classification (read-only here); this skill refines **Layer 2** (information quality, with informant proximity + bias analysis) and **Layer 3** (evidence type, evaluated against the active research questions). The key invariant: the three layers are **independent** — an original source can carry secondary information, a derivative can give direct evidence; never let one layer's value pull another. It refines fields in place by assertion `id`, **never creates assertions**, leaves the immutable extraction fields (`value`, `date`, `place`, `fact_type`, …) untouched, and calls `validate_research_schema` after writing.

## Where everything lives
- `plugin/skills/assertion-classification/SKILL.md`
- `plugin/skills/assertion-classification/references/three-layer-model.md` (295 lines) — full classification framework, BCG standards, special cases
- `plugin/skills/assertion-classification/references/validation-protocol.md` (14 lines) — the post-write validate step
- `eval/tests/unit/assertion-classification/` — `reclassify-census-informant.json`, `death-cert-secondary-informant.json`, `negative-extraction.json`, `rubric.md`
- Scenarios used: `mid-research-flynn` (all three tests)

## Current tests (3)
| id | covers | type |
|----|--------|------|
| ut_assertion_classification_001 | Refine informant proximity on an 1850-census name assertion (a_001); conservative — preserves the existing classification | positive |
| ut_assertion_classification_002 | Reclassify a_012, a death-cert birth fact reported by a son-in-law (family_not_present → Secondary) | positive |
| ut_assertion_classification_003 | "Extract the assertions and classify them" → routes to `record-extraction` | negative |

> Coverage is lopsided toward **Layer 2**: both positives are census/death-cert informant-proximity cases on existing Flynn assertions. The **Layer-3 evidence-type axis (Direct/Indirect/Negative)** is barely exercised — indirect and negative classification is the real gap.

## Gaps — new tests to add
**Positive (the Layer-3 axis and the special cases are untested):**
- **Negative evidence** — a record where a fact SHOULD appear but doesn't (will naming all children, subject absent), against an open question. The hardest distinction: meaningful absence vs. "no evidence."
- **Indirect evidence** — an assertion that implies an answer only by correlation/inference (household composition implying a relationship); must NOT be downgraded to indirect for the subject-identification name case the SKILL warns about.
- **Undetermined pre-1940 census** — the "respondent unknown → undetermined, but parents' birthplaces forced to secondary" special case (SKILL Example a_022/a_023).
- **Evidence-independence flag (Standard 46)** — two assertions sharing one informant across sources counted as ONE evidence unit.
- **No-open-questions guard** — Layer 3 can't be classified; skill should suggest `question-selection` rather than invent an evidence type.

**Negative (boundaries from the description):**
- → `record-extraction`: "Extract the assertions and classify them" — **already covered** by ut_assertion_classification_003.
- → `conflict-resolution`: "These two sources give different birthplaces — which is right?" (no negative test yet).
- → `proof-conclusion`: "Write up the conclusion that Thomas is the father." (no negative test yet).

## ⚠️ Known issues
- **Field-name drift in SKILL.md.** The "Re-invocation behavior" block names write fields `information_type`, `reliability`, `evidence_value`, `rationale` — but the Steps and the schema use `information_quality`, `informant_proximity`, `informant_bias_notes`, `evidence_type`. Reconcile to the real field names before grading, or graders will chase phantom fields.
- **Rubric has no "does not create assertions" dimension** — the never-create invariant is ungraded, mirroring the citation rubric gap.

## Fixture work
No MCP fixtures — `validate_research_schema` only. `mid-research-flynn` already carries the assertions the two positives touch. The Layer-3 gap tests need a scenario whose assertions sit against **active research questions** (negative/indirect cases depend on an open question to classify against) and a pre-1940 census assertion with an unknown respondent — either extend `mid-research-flynn` or add a focused scenario with those assertion + question stubs pre-loaded.

## Definition of done
Fix the field-name drift + add the create-guard rubric dimension → add the Layer-3 positives (negative, indirect, undetermined-census, independence-flag, no-questions-guard) → add the conflict-resolution and proof-conclusion negatives → rubric/SKILL polish → full harness pass + CRUD review + PR.
