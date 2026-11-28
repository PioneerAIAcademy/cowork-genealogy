The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

The project is saved before the first plan for `q_001`: only `q_002` has a
plan, `pl_001`, which is `completed`. `loc_001`, the locality entry for
Schuylkill County, Pennsylvania, was written into the fixture before the run,
and `external-collections.json` holds the curated list `external_links_search`
stores for the place, so the run starts with it. That is the state the fixture
was built to hold.
