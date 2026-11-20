No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

`pl_001` is `completed` and `q_001` is `in_progress`, with an empty
`search_stop` (`stopped_because` is null). That is the state the fixture was
built to hold, not an inconsistency in it.
