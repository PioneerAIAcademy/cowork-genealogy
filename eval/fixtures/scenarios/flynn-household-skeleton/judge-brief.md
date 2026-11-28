The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

The project is saved after the 1850 census search, `log_001` for `pli_001`,
and its extraction: `src_001` holds seven assertions, `a_001` to `a_007`, and
only `a_001` is linked to a person, through `pe_001` to `I2`. The tree holds
only `I1` and `I2`, and `starting-tree.gedcomx.json` holds the same two
persons. That is the state the fixture was built to hold.
