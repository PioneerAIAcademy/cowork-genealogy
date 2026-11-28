Katharina Seeger and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The project is saved before any plan: `plans` is empty and `q_001` is `open`.
`loc_001`, the locality entry for Baiersbronn, was written into the fixture
before the run. That is the state the fixture was built to hold.
