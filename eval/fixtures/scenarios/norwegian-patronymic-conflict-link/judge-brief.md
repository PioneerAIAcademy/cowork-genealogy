No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that read or write the project's own files run for real
against a temporary copy of it.

The plan's one item, `pli_001`, the 1875 census search, is `completed`
(`log_001`), and the entry it found is extracted as `a_001` and `a_002`
(persona `CP1`). No assertion is linked to a person yet: `person_evidence` is
empty. `results/log_001.json`, beside `research.json`, holds that search's
results. That is the state the fixture was built to hold.
