No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. The record the search returns is rebuilt from a tester's
session, and its ids, collection id and groom were written by hand. Tools that
read or write the project's own files run for real against a temporary copy of
it.

The project is saved before the first search: `pli_001` is `planned`, and
`log`, `sources` and `assertions` are empty. `I1` is a name with no facts and
no relative; the tree is that thin on purpose.
