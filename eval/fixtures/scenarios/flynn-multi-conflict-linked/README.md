# flynn-multi-conflict-linked

Patrick Flynn parentage research with two unresolved conflicts active simultaneously. Same as `flynn-with-birthplace-conflict` plus a second identity conflict.

- **Conflicts:**
  - `c_001` — birthplace (Ireland vs Pennsylvania), fact conflict, status: `unresolved`
  - `c_002` — identity (which Patrick Flynn in 1850 Schuylkill County is the subject?), identity conflict, status: `unresolved`
- **Both conflicts have:** null `preferred_assertion_id`, null `independence_analysis`, null `weighing_analysis`, null `resolution_rationale`. Both list `q_001` in `blocks_question_ids`.
- **Everything else:** Same as `mid-research-flynn`.
- **`ps_001.resolved_conflict_ids` is `[]`,** not `["c_001"]` as the parent has it: `c_001` is unresolved here, and a proof summary may only cite a conflict that is `resolved` or `moot` (issue #1972 V5, enforced by `validator.ts`).


## Used by

- `conflict-resolution` **prioritization** tests — when two conflicts exist, which should be tackled first?
- Tests verifying that the skill addresses one conflict at a time rather than producing tangled resolution prose covering both.
- tests where the next step must address whichever conflict the skill identifies as most blocking. Under step mode that is a step on the open question, not a new question.

## Two distinct conflict shapes

- **Fact conflict (c_001):** at least 2 competing assertions, named `disputed_attribute`, null `identity_question`.
- **Identity conflict (c_002):** at least 1 competing assertion (the assertion whose person linkage is uncertain), null `disputed_attribute`, populated `identity_question`.

This is the only scenario in the seed corpus where both conflict types are simultaneously present.

## Why this copy exists, and what its links are

A copy of `flynn-multi-conflict` in which Patrick's own facts are linked, rather than only
the relationship assertions that name him. In `flynn-multi-conflict` his 1860 census entry
and his death certificate are reached ONLY through two-party relationship
assertions (a_010, a_013), so a strict reading of "the assertions linked to
this person" finds him no 1860 residence and no death.

Twelve live `person_evidence` rows. Six are the original scenario's. The six
added here are of two kinds, and the distinction is the point of the copy:

**Agent-written links** — what a researcher's person-evidence pass produces:

| row | assertion | record entry |
|---|---|---|
| pe_007 | a_008 (name) | 1860 census, child_2 |
| pe_009 | a_011 (death) | 1908 death certificate, deceased |

**Tool-derived rows** — written by `research_append` because a link claims the
whole record entry, not the one fact it names. Each carries no `match_score`
and a rationale naming the link it came from:

| row | assertion | derived from | record entry |
|---|---|---|---|
| pe_011 | a_002 (birth) | a_001 | 1850 census, child_1 |
| pe_012 | a_003 (residence) | a_001 | 1850 census, child_1 |
| pe_008 | a_009 (birth) | a_008 | 1860 census, child_2 |
| pe_010 | a_012 (birth) | a_011 | 1908 death certificate, deceased |

a_012 ("Born 1845, Pennsylvania") is the rejected side of conflict c_001. It is
linked here deliberately: a timeline must leave it out because the conflict
rejected it, not because nothing linked it.
