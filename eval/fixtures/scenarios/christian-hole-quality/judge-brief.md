The persons in this project are authored test fixtures with FamilySearch
shaped ids (`KD96-TV2` to `KD96-TV5`), not real FamilySearch profiles. No call
reaches FamilySearch: every tool response in this run is mocked.

The project's local tree and the mocked FamilySearch responses differ by
design. The local `tree.gedcomx.json` gives `KD96-TV2` nine facts: Birth,
Marriage, five Residences, a Burial with a place and no date, and Death. The
mocked `person_read` for `KD96-TV2` returns four: Birth 1875, Marriage
1 May 1898, Residence 1900, and Death 10 June 1945. Tool responses describe
the FamilySearch profile; the local tree is the project's own copy of it.

`research.json` holds the project record and nothing else: no questions,
plans, sources or assertions.
