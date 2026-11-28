William Brown and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The project is saved before the first search: `pli_001` is `planned`, and
`log`, `sources` and `assertions` are empty. `I1` holds one fact, a Birth in
1872 in Virginia, and no relative; the tree is that thin on purpose.
