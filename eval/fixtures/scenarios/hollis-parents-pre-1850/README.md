# hollis-parents-pre-1850

Project state immediately after `init-project` runs successfully, for a
verify-parents objective whose subject was born before 1800 and whose
putative father died before 1850 — the first US census to name every
household member (1850) postdates the father's death, so no census record
can independently confirm this parentage. The objective is captured, a stub
person exists in `tree.gedcomx.json`, but no research work has been done yet.

- **Objective:** Identify the parents of Reuben Hollis (b. ~1795, Rowan
  County, North Carolina); a family record names Ezekiel Hollis (died 1847)
  as a possible father, unconfirmed
- **Questions:** none
- **Plans:** none
- **Log:** empty
- **Sources:** none
- **Assertions:** none
- **GedcomX persons:** I1 (Reuben Hollis — stub, name only, no facts)
- **GedcomX relationships:** none
- **GedcomX sources:** none

## Used by

- `question-selection` issue #4166: a first-question hand-back must not name
  record types (census, vital, probate) — even though the general-knowledge
  instinct this case invites ("no pre-1850 census names children, so check
  the father's probate/estate instead") is exactly the record-weighing that
  belongs to research-plan, not question-selection.

## What this scenario tests boundary-wise

Naming any census, vital, probate or other record target in the next-step
hint or `summary_for_user` is a Correctness failure (issue #4166), even when
the reasoning behind naming that record type is sound. Choosing which record
set to search is research-plan's job, which weighs record types against the
locality and period; question-selection's job stops at framing the question.
