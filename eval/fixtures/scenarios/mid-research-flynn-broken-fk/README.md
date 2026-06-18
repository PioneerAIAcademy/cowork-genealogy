# mid-research-flynn-broken-fk

Single-mutation derivative of `mid-research-flynn` for project-status
broken-foreign-key detection (test `ut_project_status_005`).

- **Mutation:** `person_evidence` entry `pe_003` has its `person_id`
  changed from `I2` to `I9`. `I9` does not exist in `tree.gedcomx.json`
  (which contains only `I1` Patrick and `I2` Thomas).
- **Why this shape:** matches the exact example in
  `project-status/SKILL.md` Step 2 ("person_evidence entry pe_003
  references person 'I9' which no longer exists in tree.gedcomx.json").
  Simulates a dangling reference left behind by a manual edit or merge.
- **Expected skill behavior:** surface a broken-foreign-key warning,
  naming `pe_003` and the missing `I9`, **at the top** of the report —
  not buried in the narrative.
- Everything else is identical to `mid-research-flynn` (otherwise clean).
