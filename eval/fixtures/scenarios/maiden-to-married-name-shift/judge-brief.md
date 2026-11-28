No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved after one search, `log_001`, a death record search that
belongs to no plan item, whose results are in `results/log_001.json`. It gave
`src_001`, a 1921 death certificate, with one assertion, `a_001`, not yet
linked to a person. `pli_001` is `in_progress` and `pli_002` is `planned`.
That is the state the fixture was built to hold.
