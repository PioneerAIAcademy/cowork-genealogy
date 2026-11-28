No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The project is saved before the first search for `pli_001`, which is
`in_progress`: `log`, `sources` and `assertions` are empty. The tree holds the
couple, `I1` and `I2`, and two of their children, `I3` and `I4`, none of them
with a source. That is the state the fixture was built to hold.
