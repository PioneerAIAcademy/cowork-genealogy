No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved before the first search for `pli_001`, which is
`in_progress`: `log`, `sources` and `assertions` are empty, and none of the
tree's three persons carries a source. That is the state the fixture was built
to hold.
