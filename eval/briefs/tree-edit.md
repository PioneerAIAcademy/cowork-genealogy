# Deep-Dive Brief — `tree-edit`

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).

**Effort profile:** Both, weighted toward genealogical mechanics. The skill's most complex behavior — a **person merge** with full referential-integrity rewrites across both files — is completely untested, and a real mutating edit (value correction, new fact, person creation) has no test either. The match-checking tools are well-fixtured; the gap is merge-correctness scenarios + a thin rubric.

**Files:** SKILL.md (328 lines) · references ×4 (227 lines) · tests ×5 · rubric ✓ (19 lines — thin).

## What this skill does
Direct edits to `tree.gedcomx.json` (the simplified-GedcomX deliverable). Operations: add a fact, correct a value, create a person, add a relationship, **merge two persons confirmed identical**, **verify** the tree already reflects a known fact (no-op confirmation), check what records FamilySearch has matched/attached (`person_record_matches`), and check for possible duplicate persons (`person_person_matches`). Places get standardized via `place_search`; every edit ends with `validate_research_schema`. **Key invariants: edits are evidence-grounded and minimal (surgical — touch only the target field); sourced *evidence* facts/edges land at identity-link time (person-evidence's `materialize_facts`, NOT proof-gated) — the `probable`+ gate here applies only to a *concluded* value (`primary`/`preferred`), an upload, or a merge; merges require a proof-conclusion at probable-or-higher and rewrite ALL references** (relationships, `person_evidence.person_id`, `timelines.person_ids`, `subject_person_ids`) before deleting the deprecated person; **a verification of already-correct data makes NO change** and never adds non-spec fields (`confidence`/`notes`) to "mark" it.

## Where everything lives
- `plugin/skills/tree-edit/SKILL.md`
- `references/evidence-grounded-edits.md` (55 — when an edit is justified, source-support threshold), `places-guidance.md` (81 — place standardization), `relationship-accuracy.md` (77 — relationship-type/merge implications), `validation-protocol.md` (14)
- `eval/tests/unit/tree-edit/` — `add-birth-fact.json`, `add-relationship-after-proof.json`, `negative-record-extraction.json`, `person-record-matches.json`, `person-person-matches.json`, `rubric.md`
- Scenarios: `mid-research-flynn` (ut_001/002/004/005), `mid-research-flynn-1880-found` (negative ut_003). Fixtures: `person-record-matches-flynn` (+ two arg-variant fixtures), `person-person-matches-flynn`.

## Current tests (5)
| id | covers | type | fixtures |
|----|--------|------|----------|
| ut_tree_edit_001 | Verify a birth fact matches the resolved conflict — a NO-OP edit (minimality) | positive | — |
| ut_tree_edit_002 | Verify a ParentChild edge (materialized at link time, carrying a source-ref) is present + correct — no-op/verify | positive | — |
| ut_tree_edit_003 | "Add facts from the 1880 census to the tree" → route to record-extraction | negative | — |
| ut_tree_edit_004 | Report record matches/hints for a tree person | positive | person-record-matches-flynn (+2 arg variants) |
| ut_tree_edit_005 | Find possible duplicate tree persons (merge candidates) | positive | person-person-matches-flynn |

> **No test performs a real mutating edit.** Both edit positives (ut_001, ut_002) are no-op/verify paths. There is no test that actually corrects a value, adds a genuinely new fact, creates a person, or — the headline — **merges two persons**. The match-checking tools are the best-fixtured part of the skill; the editing core is the least-tested.

## Gaps — new tests to add
**Positive (the mutating-edit core, all untested):**
- **Person merge** (the big one) — two confirmed-identical persons (a synthetic `I`-stub into a FamilySearch-ID person, per the SKILL example) collapsed into one: combine names/facts without dropping alternates, rewrite every relationship + `person_evidence.person_id` + `timelines.person_ids` + `subject_person_ids` to the keep ID, delete the deprecated person, then `validate_research_schema` clean. This is the skill's most complex operation and has zero coverage.
- **Real value correction** — a genuine fix (wrong birth year → corrected), asserting edit minimality (only `facts[].date` changes; unrelated facts/persons byte-for-byte unchanged).
- **Add a genuinely new fact** — an Occupation/Death fact not already present, with `standard_place` resolved via `place_search` and a source ref.
- **Create a person + relationship** — a new `I`-ID person plus a ParentChild relationship meeting the relationship-accuracy threshold.
- **Conflicting facts during merge** — both persons carry a different birth date with no proof-specified value → keep BOTH and flag for proof-conclusion (don't silently discard).

**Negative (boundaries from the description):**
- → `record-extraction`: "Add facts from the 1880 census." — **already covered** (ut_003).
- → `proof-conclusion`: "Write the conclusion that these two are the same person." — analytical decision belongs to proof-conclusion; tree-edit only executes the merge after. Untested.
- → `person-evidence`: "Link this 1850 census assertion to Patrick." — linking assertions to persons is person-evidence, not a tree edit. Untested.

## ⚠️ Known issues
- **Merge is unfixtured and unspecced in tests** — the most error-prone operation (cross-file reference rewrite + delete) has no test guarding regressions; a missed reference silently creates a broken foreign key that only `validate_research_schema` would catch.
- **Thin rubric for a multi-operation skill.** 19 lines cover data-preservation + edit-minimality only. Missing: a **merge-correctness** dimension (all references updated, deprecated person removed, no data dropped) and an **evidence-grounding / source-support** dimension (per `evidence-grounded-edits.md`, edits without a source must be refused or routed).
- **Verify-no-op tested, real-edit not** — the minimality dimension currently only ever sees no-op inputs, so it's never exercised against an actual mutation.

## Fixture work
Match-checking is fully fixtured (`person-record-matches-flynn` + two arg variants, `person-person-matches-flynn`), and `validate_research_schema` has a fixture. The merge and mutating-edit tests mostly need **scenario** work, not MCP fixtures: a scenario containing a synthetic stub + a FamilySearch-ID duplicate that are cross-referenced from `person_evidence`/`timelines`/`subject_person_ids` so the reference-rewrite is actually exercised. New facts with a place will need a `place-search-*` fixture (several already exist — Schuylkill/Pennsylvania/Ireland — reuse where the place matches).

## Definition of done
Build the merge scenario + the merge/conflict-merge tests + ≥2 real mutating-edit tests (correction, new fact, create-person) → add merge-correctness and evidence-grounding rubric dimensions → add the proof-conclusion and person-evidence negatives → full harness pass + CRUD review + PR.
