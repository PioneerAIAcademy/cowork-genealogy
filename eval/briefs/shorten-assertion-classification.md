# Shorten: assertion-classification

**Bucket:** A (dead-mechanics removal) — but with a large protected craft core
**Primary owner:** both (developer cuts the tool/JSON mechanics + boilerplate;
**genealogist owns the three-layer classification judgment**)
**Current size:** 301 lines → **Target:** ~190–210 lines (~33% reduction)
**Tool migration:** **done** — calls `research_append` (`op:"update"` **only**)
and `person_warnings` (via the `check-warnings` step).
**Still needed as a skill?** **Yes, unambiguously** — the tool only persists
fields; the entire value is the GPS taxonomy reasoning (informant analysis,
the two-question information-quality tree, direct/indirect/negative against an
open question, the pre-1940 census special case). That is graded craft the tool
cannot supply.

## TL;DR
The migration is complete — `op:"update"`-only is correct, and the post-write
`validate_research_schema` call is already gone (the skill ends on
`check-warnings`). Cut the verbose `research_append({...})` JSON block, the
immutable-field recitation (now structural — you only ever pass classification
fields), and the boilerplate "Re-invocation behavior" section. **Do not touch**
the classification judgment in Steps 2–5, the subject-id hard rule, or the two
worked examples — they map 1:1 onto the rubric. This is a modest-yield file;
don't chase a brittle minimum.

## Why this skill is shortenable
`research_append` now assigns nothing, validates-before-persist, and rejects any
attempt to mutate the immutable extraction fields. So the prose that enumerates
those immutable fields, narrates "the tool validates and writes nothing on
errors," and dumps the full update-call JSON is redundant with the tool's own
schema and guarantees. The judgment around *which value* to write is not — that
is the whole skill.

## The floor: what the unit tests actually grade
- **Deterministic validators**
  (`eval/harness/validators/test_assertion_classification.py` + universal):
  - `test_no_mcp_tools_called` — only `research_append`/`person_warnings` (and
    `validate_research_schema` is *exempted*, not required). Don't introduce
    other MCP tools.
  - `test_does_not_add_new_assertions` — no new `a_` ids (positive tests). This
    is what `op:"update"`-only protects.
  - `test_source_classification_unchanged` — Layer 1 on `sources` is read-only.
  - `test_a012_secondary_family_not_present` (tag `a012-secondary-family-not-present`)
    — a_012 must end `information_quality: "secondary"`,
    `informant_proximity: "family_not_present"`.
  - `test_a001_preserves_classification` (tag `a001-preserves-classification`) —
    a_001 stays `indeterminate` + `direct`, and `value`/`source_id` unchanged.
  - Universal ownership table: writes only the `assertions` section.
- **Rubric dims** (`eval/tests/unit/assertion-classification/rubric.md`, 128 lines):
  *Three-layer accuracy* (layers kept independent), *Informant analysis*
  (informant ≠ recorder; proximity scale; pre-1940 census + X-marker rule),
  *Evidence independence & scope guards* (shared-informant = one unit;
  no-open-questions decline + question-selection handoff), *Invariant
  preservation* (classification fields only, immutables untouched),
  *Classification justification* (cite the specific informant/source facts).
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:** `negative-extraction` → record-extraction (don't
  pull facts from new record data); `negative-conflict-resolution`,
  `negative-proof-conclusion`, `negative-evidence-will-omission` (the last
  checks "absence not expected = no evidence," not negative evidence).
- **Key test files:** `death-cert-secondary-informant`, `reclassify-census-informant`,
  `subject-id-name-stays-direct`, `no-open-questions-guard`,
  `undetermined-pre1940-census`, `evidence-independence-shared-informant`,
  `indirect-household-relationship`, `multiple-informants-one-deathcert`.

## CUT — safe to remove
- **[~206–230] the `research_append({...})` JSON block + immutable-field
  recitation** — the tool schema documents the params, and "you only ever pass
  classification fields; the immutable fields … are not yours to pass and the
  tool will not let you mutate them" is now **structural** (the tool enforces
  it). Collapse to one line: *"Write each changed classification with
  `research_append({ section:'assertions', op:'update', entryId, fields })`,
  passing only the classification fields that changed (`information_quality`,
  `informant`, `informant_proximity`, `informant_bias_notes`, `evidence_type`,
  `extracted_for_question_ids`). The tool validates and writes nothing on
  `{ ok:false, errors }` — surface those."* Keep the `op:"update"`-never-append
  rule (one clause).
- **[~287–301] "Re-invocation behavior"** — pure boilerplate. The "never
  duplicate / update in place, don't create new assertions" point is already
  made by the Step-6 `op:"update"`-never-append rule and the no-new-assertions
  validator. Delete the section.
- **Repeated "tool validates before persisting / writes nothing on errors"
  narration** — appears at ~227–230; state once (folded into the one-line write
  instruction above).

## KEEP — load-bearing judgment (do NOT cut)
- **Step 2 "Analyze the informant"** (informant ≠ recorder/indexer; the
  six-value proximity scale; the bias checklist) — *Informant analysis* dim,
  and the data behind `test_a012_*`.
- **Step 3 "Classify information quality"** (the two-question tree; "primary ≠
  accurate"; can't be primary about own birth; one source can carry both; the
  full **pre-1940 census** block — indeterminate-not-forced-secondary, with the
  parent's-birthplace exception) — *Three-layer accuracy* + *Informant analysis*;
  directly backs `undetermined-pre1940-census` and the a_001/a_023 verdicts.
- **Step 4 "Classify evidence type"** including the **no-open-questions guard**
  (decline Layer-3, recommend opening a question, phrase as present-tense
  action) and the **Subject-identification rule + the "Hard rule" callout**
  (a null `place` on a subject-id name assertion is NOT a downgrade to
  indirect; a_001 stays `direct`) — *Evidence independence & scope guards* +
  *Three-layer accuracy*; backs `no-open-questions-guard`,
  `subject-id-name-stays-direct`, `indirect-household-relationship`.
- **Step 5 "Flag evidence independence concerns"** (same informant across
  sources = one evidence unit, no extra credibility) — *Evidence independence*
  dim; backs `evidence-independence-shared-informant`.
- **Step 6 first paragraph** (write back even on an assertion the user didn't
  name, and even when the answer is "leave it" — a question-shaped prompt isn't
  read-only) — protects *Correctness* on the "should a_006 really be direct?"
  style prompts; keep, tighten.
- **Both worked examples** ("Death certificate" and "Pre-1940 Census") — these
  are the rubric's reference verdicts in miniature; high signal per line. Keep.
- **Core Principles** (layers independent; this skill is Layer 2 + Layer 3,
  Layer 1 read-only) — frames *Three-layer accuracy* + the source-classification
  validator. Keep, it's short.
- **Step 7 `check-warnings`** — genealogical plausibility the persistence step
  can't catch. Keep (this is the surviving warnings step; only the post-write
  *validate* was cut, and it's already gone).

## TIGHTEN — keep the point, cut the words
- Step 6's three sentences re-arguing "write even when the answer is leave-it"
  can become two. The point is load-bearing; the repetition isn't.
- Step 8 "Present results" is fine but can drop to a tight bullet list (it
  largely restates what the prior steps produced).
- The "Critical distinctions" bullets at the end of Step 4 partly restate the
  no-evidence/negative rules already in the Decision rules above them — merge.

## Suggested target structure (~200 lines)
1. Frontmatter + Narration + the `references/three-layer-model.md` load line.
2. Core Principles (layers independent; Layer 2+3 only, Layer 1 read-only).
3. Steps 1–5 — the judgment, kept; prose tightened.
4. Step 6 — the "write-back even if unnamed/leave-it" rule (2 sentences) + the
   **one-line** `op:"update"` write instruction (no JSON block, no immutable
   list).
5. Step 7 `check-warnings`; Step 8 present (bullets).
6. Both worked examples — kept.
7. (Delete "Re-invocation behavior" entirely.)

## Verify
```
cd eval/harness && uv run python run_tests.py --skill assertion-classification
```
Watch *Three-layer accuracy*, *Informant analysis*, and *Evidence independence
& scope guards*; confirm the a_012 and a_001 tag-gated validators stay green,
`no-open-questions-guard` still declines + hands off to question-selection, and
`negative-extraction` still routes to record-extraction.

## Owner notes
**Developer** safely cuts the JSON block, the immutable-field recitation, the
validate-narration, and "Re-invocation behavior." **Genealogist** owns Steps
2–5, the subject-id hard rule, and the two examples — that is the graded
taxonomy craft and the source of every tag-gated verdict; a mechanical pass
must not touch them.

**Fix in this PR:** the rubric's *Invariant preservation* dim still reads
"`validate_research_schema` is called after writing" (`rubric.md` line 104), but
the SKILL.md no longer makes that call (the migration ended the flow on
`check-warnings`) and the validator only *exempts* `validate_research_schema`,
never requires it. The rubric line is stale relative to the migrated skill —
**edit `rubric.md` line 104** to drop the post-write-validate assertion (re-word
to the `check-warnings` step, or remove the clause). Editing `rubric.md` flips
run logs inactive, so you re-run + re-annotate anyway as part of this PR; the
senior reviews the rubric change alongside the cuts.
