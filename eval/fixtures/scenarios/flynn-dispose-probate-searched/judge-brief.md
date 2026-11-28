The Flynn family, its records and their ids are invented test fixtures, not
real FamilySearch data. No call in this run reaches FamilySearch or the wiki:
those answers come from test fixtures. Tools that read or write the project's
own files run for real against a temporary copy of it.

This is a copy of `flynn-identity-geographic-thin`. That scenario's 1860 census
and 1908 death certificate, with their log entries, assertions, person links,
conflict and proof summary, were removed on purpose, so the ids skip numbers;
nothing is missing. The copy adds one log entry, `log_007`, a probate search
tied to `pli_006`. That is the state the fixture was built to hold.
