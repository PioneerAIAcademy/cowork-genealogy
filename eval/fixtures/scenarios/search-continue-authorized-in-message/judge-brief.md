Michael Sheahan and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The plan `pl_001` is active with two items, `pli_001` (the 1880 census) and
`pli_002` (church records, 1880 to 1885), both `planned`; nothing has been
searched yet. `SYNTH-PA-CHURCH`, the collection id in `pli_002`'s rationale, is
a test fixture collection, not a FamilySearch one. That is the state the
fixture was built to hold.
