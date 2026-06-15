# flynn-multi-conflict

Patrick Flynn parentage research with two unresolved conflicts active simultaneously. Same as `flynn-with-birthplace-conflict` plus a second identity conflict.

- **Conflicts:**
  - `c_001` — birthplace (Ireland vs Pennsylvania), fact conflict, status: `unresolved`
  - `c_002` — identity (which Patrick Flynn in 1850 Schuylkill County is the subject?), identity conflict, status: `unresolved`
- **Both conflicts have:** null `preferred_assertion_id`, null `independence_analysis`, null `weighing_analysis`, null `resolution_rationale`. Both list `q_001` in `blocks_question_ids`.
- **Everything else:** Same as `mid-research-flynn`.

## Used by

- `conflict-resolution` **prioritization** tests — when two conflicts exist, which should be tackled first?
- Tests verifying that the skill addresses one conflict at a time rather than producing tangled resolution prose covering both.
- `question-selection` tests where the next research question must address whichever conflict the skill identifies as most blocking.

## Two distinct conflict shapes

- **Fact conflict (c_001):** at least 2 competing assertions, named `disputed_attribute`, null `identity_question`.
- **Identity conflict (c_002):** at least 1 competing assertion (the assertion whose person linkage is uncertain), null `disputed_attribute`, populated `identity_question`.

This is the only scenario in the seed corpus where both conflict types are simultaneously present.
