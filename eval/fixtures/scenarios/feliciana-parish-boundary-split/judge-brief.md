Silas Bankston and the project's ids are invented test fixtures, not real
FamilySearch data; the 1824 split of Feliciana Parish that `loc_001` records
is real Louisiana history. No call in this run reaches FamilySearch or the
wiki: those answers come from test fixtures. Tools that read or write the
project's own files run for real against a temporary copy of it.

The project is saved before the first plan for `q_001`: `plans` is empty.
`log_001`, an 1820 census search that belongs to no plan item, gave `src_001`
and one assertion, `a_001`, not linked to a person. `loc_001` was written into
the fixture before the run. That is the state the fixture was built to hold.
