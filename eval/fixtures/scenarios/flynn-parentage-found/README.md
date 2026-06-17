# flynn-parentage-found

Patrick Flynn parentage research — the father (Thomas Flynn) has been confirmed, but the mother is unknown. The project is still active because the objective ("Identify the parents") requires both parents.

## State

- **Objective:** Identify the parents of Patrick Flynn, born ca. 1845 in Pennsylvania, died 1908 in Schuylkill County, PA
- **Questions:** q_001 (Who was Patrick Flynn's father? — resolved: Thomas Flynn), q_002 (1850 census placement — resolved)
- **Plans:** pl_001 (1850 census, completed), pl_002 (paternity evidence, completed)
- **Project status:** active — mother not yet identified
- **Proof summary:** ps_001 tier `proved` for the paternity sub-question

## Differs from `mid-research-flynn`

- **`questions[q_001]`:** Rescoped to "Who was Patrick Flynn's father?" (not "parents"), `status: "resolved"`, `resolution_assertion_ids` populated, `exhaustive_declaration.declared: true`
- **`plans[pl_002]`:** `status: "completed"`, probate item (`pli_006`) added and completed (negative result)
- **`log`:** Adds `log_006` — probate search, negative outcome
- **`proof_summaries[ps_001].tier`:** `proved` (three independent sources, conflict resolved, probate searched)

## Used by

- `question-selection` tests where the next question should set `depends_on: ["q_001"]` — specifically, a question about Patrick Flynn's mother, which is most efficiently pursued by examining the same Thomas Flynn household records (and thus depends on the confirmed father identification from q_001).
- Tests of the **Dependency-awareness** rubric dimension: `depends_on` and `unblocks` must be correctly populated when prior questions are relevant.
