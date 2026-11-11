# flynn-multi-conflict-timeline-links

A copy of `flynn-multi-conflict` for the timeline suite's person-timeline tests.
I1 is also linked to the one-party assertions of the three personas already linked to
him: a_002 and a_003 (1850 census), a_008 and a_009 (1860 census), a_011 and a_012
(death certificate), each at its record's existing confidence (pe_007–pe_012).

Patrick Flynn parentage research with two unresolved conflicts active simultaneously. Same as `flynn-with-birthplace-conflict` plus a second identity conflict.

- **Conflicts:**
  - `c_001` — birthplace (Ireland vs Pennsylvania), fact conflict, status: `unresolved`
  - `c_002` — identity (which Patrick Flynn in 1850 Schuylkill County is the subject?), identity conflict, status: `unresolved`
- **Both conflicts have:** null `preferred_assertion_id`, null `independence_analysis`, null `weighing_analysis`, null `resolution_rationale`. Both list `q_001` in `blocks_question_ids`.
- **Everything else:** Same as `mid-research-flynn`.
- **`ps_001.resolved_conflict_ids` is `[]`,** not `["c_001"]` as the parent has it: `c_001` is unresolved here, and a proof summary may only cite a conflict that is `resolved` or `moot` (issue #1972 V5, enforced by `validator.ts`).


## Used by

- `timeline-with-multi-conflict` (the timeline suite): a person timeline built while both conflicts are unresolved.

## Two distinct conflict shapes

- **Fact conflict (c_001):** at least 2 competing assertions, named `disputed_attribute`, null `identity_question`.
- **Identity conflict (c_002):** at least 1 competing assertion (the assertion whose person linkage is uncertain), null `disputed_attribute`, populated `identity_question`.

This and `flynn-multi-conflict` are the only scenarios in the seed corpus where both conflict types are simultaneously present.
