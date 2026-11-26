Michael Sheahan and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The project is saved before the first plan for `q_001`: `plans` is empty, and
`h_001` is `active` with no supporting or contradicting assertion. `log_001`
(an 1870 census) and `log_002` (an 1882 directory) belong to no plan item, and
nothing was extracted from them: the project holds no source or assertion. The
one locality entry, `loc_001`, for Schuylkill County, Pennsylvania, was
written into the fixture before the run. That is the state the fixture was
built to hold.
