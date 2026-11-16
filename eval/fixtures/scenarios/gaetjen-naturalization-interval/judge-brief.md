The records and the tree are taken from a real research run on the public
FamilySearch tree; every tool response in the test is mocked.

The project has no `namesakes` rows. That is intentional, so namesake handling
plays no part in this test. The other Gaetjen men named in the log notes
(`log_005`, `log_006`, `log_019`) are search history.

`results/` holds the search result files for the project's log entries. They
are carried over unchanged from the original run.

The 1871 arrival (`src_002`, assertions `a_010` to `a_014`) is linked to I1 before the run, by `pe_001` to `pe_005`, and I1 carries it as Immigration fact `F3`. That link is part of the fixture: it stands for an identification the researcher made, so the arrival and the naturalization are one person's records. It is not under review in this test.
