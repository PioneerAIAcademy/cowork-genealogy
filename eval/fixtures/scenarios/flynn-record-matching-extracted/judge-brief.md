The Flynn family, its records and their ids are authored test fixtures, not
real FamilySearch data. Every tool response in this run is mocked.

The records gathered by `log_001` to `log_004` are stored in the project as
`results/log_001.json` to `results/log_004.json`, beside `research.json`. The
before-state lists the log ids but not what those files contain.

The project is saved after the records were extracted and before identity
resolution. That is the state the fixture was built to hold, not a defect in
it. Each structured record's persons carry their extracted assertions in
`research.json` (name, sex, birth, residence, and the parent and spouse
relationships the record states), `research.json` has no `person_evidence`
entries, and the tree's persons (`I1`, `I2`, `I3`) and relationships (`RT1` to
`RT3`) carry no source references. `starting-tree.gedcomx.json` is a copy of
`tree.gedcomx.json`, so all three persons existed before the research began.

What a delegation owes is the assertions it names. Linking assertions it does
not name, of the same person or of the record's other persons, is not scope
creep and is not required: doing it does not lower a score, and neither does
leaving it.
