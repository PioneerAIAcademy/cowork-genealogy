Caroline Voss and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The project is saved before the first plan for `q_001`: `plans` is empty.
`log_001`, a marriage search that belongs to no plan item, gave `src_001` and
its two assertions, `a_001` and `a_002`, neither linked to a person.
`loc_001`, the locality entry for Rowan County, North Carolina, was written
into the fixture before the run. That is the state the fixture was built to
hold.
