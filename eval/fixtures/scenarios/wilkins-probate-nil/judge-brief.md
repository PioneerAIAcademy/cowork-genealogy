No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved before the first search: `pli_001` is `planned`, and
`log`, `sources` and `assertions` are empty. That is the state the fixture was
built to hold.
