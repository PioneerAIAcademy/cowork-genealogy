The persons and records in this project are authored test fixtures with
FamilySearch-shaped ids (`KD96-TV2` to `KD96-TV4`, records `HOLE-001` to
`HOLE-004`), not real FamilySearch data. No call reaches FamilySearch: every
tool response in this run is mocked or computed offline.

The local tree gives `KD96-TV2` four facts (Birth 1875 Norway, Marriage
1 May 1898 Polk, Residence 1900 Fairview, Death 10 June 1945 Erskine) and four
attached sources, S1 to S4: the 1900 census (`HOLE-001`), the Minnesota death
index (`HOLE-002`), the 1885 Minnesota state census (`HOLE-003`) and an 1898
Polk County marriage (`HOLE-004`).

`research.json` holds what reading those four attached records produced: four
`record_read` log entries with their result files, four sources, the
assertions extracted from each record, and links from the persona of
`KD96-TV2` in each record to `KD96-TV2`. It holds no questions, plans,
conflicts or conclusions.

The mocked FamilySearch `person_read` lists the same records under its own
source ids (`SD-HOLE-A`, `-B`, `-C`, `-F`), plus an uploaded memory
(`SD-HOLE-D`) and a source on a child (`SD-HOLE-E`) that the local tree does
not carry. The project's S ids and FamilySearch's SD ids name the same records
where the record ARK is the same.
