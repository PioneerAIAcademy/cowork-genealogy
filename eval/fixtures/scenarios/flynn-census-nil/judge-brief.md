Patrick Flynn and the project's ids are invented test fixtures, not real
FamilySearch data. No call in this run reaches FamilySearch or the wiki: those
answers come from test fixtures. Tools that read or write the project's own
files run for real against a temporary copy of it.

The project is saved before any search: `pli_001` is planned, and `log`,
`sources` and `assertions` are empty. `external-collections.json`, beside
`research.json`, holds six stored external-site collections, five on Ancestry
and one on MyHeritage, for Pennsylvania and for Schuylkill County. Both are
part of the fixture.
