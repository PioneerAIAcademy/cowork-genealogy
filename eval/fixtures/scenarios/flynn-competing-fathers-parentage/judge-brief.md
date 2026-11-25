The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

The tree holds two men named Thomas Flynn. `I2` is already Patrick's (`I1`)
father through `R1`, sourced `S1`, `S2` and `S3`. `I3` is the second
candidate: source `src_008` (`S8`), an 1845 baptism, has a relationship
assertion `a_018` naming the father as Thomas Flynn, and `pe_010` links
`a_018` to `I3` at `speculative`. A write that adds `I3` as a second father of
`I1` is refused by the tree writers with a `conflicts_surfaced` entry. That
state and that refusal are what the fixture was built to hold, not defects in
it.
