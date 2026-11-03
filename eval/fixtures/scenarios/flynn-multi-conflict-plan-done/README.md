# flynn-multi-conflict-plan-done

`flynn-multi-conflict` with `pli_006` completed, so `q_001` has a proof summary and nothing left planned or in progress. A new question can then be added beside it; in the parent scenario the in-progress `pli_006` blocks one.

Patrick Flynn parentage research with two unresolved conflicts active simultaneously. Same as `flynn-with-birthplace-conflict` plus a second identity conflict.

- **Conflicts:**
  - `c_001` — birthplace (Ireland vs Pennsylvania), fact conflict, status: `unresolved`
  - `c_002` — identity (which Patrick Flynn in 1850 Schuylkill County is the subject?), identity conflict, status: `unresolved`
- **Both conflicts have:** null `preferred_assertion_id`, null `independence_analysis`, null `weighing_analysis`, null `resolution_rationale`. Both list `q_001` in `blocks_question_ids`.
- **Everything else:** Same as `mid-research-flynn`.
- **`ps_001.resolved_conflict_ids` is `[]`,** not `["c_001"]` as the parent has it: `c_001` is unresolved here, and a proof summary may only cite a conflict that is `resolved` or `moot` (issue #1972 V5, enforced by `validator.ts`).


## Used by

- `ut_question_selection_003` (`prioritize-blocked-question.json`) — the next research question must address whichever conflict the skill identifies as most blocking.

## Two distinct conflict shapes

- **Fact conflict (c_001):** at least 2 competing assertions, named `disputed_attribute`, null `identity_question`.
- **Identity conflict (c_002):** at least 1 competing assertion (the assertion whose person linkage is uncertain), null `disputed_attribute`, populated `identity_question`.

This is the only scenario in the seed corpus where both conflict types are simultaneously present.
