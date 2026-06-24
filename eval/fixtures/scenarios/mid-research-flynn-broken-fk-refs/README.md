# mid-research-flynn-broken-fk-refs

Derivative of `mid-research-flynn` exercising the two structural
broken-foreign-key variants project-status checks beyond
`person_evidence` (test `ut_project_status_006`).

- **Mutations (two):**
  - `project.subject_person_ids` changed from `["I1"]` to `["I1", "I9"]`.
  - `timelines[0].person_ids` (`t_001`) changed from `["I1"]` to
    `["I1", "I9"]`.
  - `I9` does not exist in `tree.gedcomx.json` (only `I1` and `I2` do).
- **Why this shape:** `project-status/SKILL.md` Step 2 lists four
  foreign-key sources; `person_evidence` is covered by
  `mid-research-flynn-broken-fk`, and this scenario covers the
  `subject_person_ids` and `timelines.person_ids` variants in one run.
  `I1` remains valid in both arrays so the dangling `I9` is the only
  defect (a stale id a merge could leave behind).
- **Expected skill behavior:** surface broken-foreign-key warnings for
  **both** the dangling `subject_person_ids` reference and the dangling
  `timelines` (t_001) reference, at the top of the report.
- Everything else is identical to `mid-research-flynn` (otherwise clean).
