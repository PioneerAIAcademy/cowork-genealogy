No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved before the first search for `pli_001`, which is
`in_progress`; `pli_002` is `planned`. `src_001`, an 1880 census source, has
no log entry and no assertions. That is the state the fixture was built to
hold.
