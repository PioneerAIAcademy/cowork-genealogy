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

A delegation that names one assertion of a record person is about that person:
linking the person's other assertions from the same record in the same pass,
and the record's other persons to the tree persons they match, is expected and
is not scope creep.
