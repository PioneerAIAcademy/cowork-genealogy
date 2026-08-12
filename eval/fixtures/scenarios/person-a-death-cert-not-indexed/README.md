# Scenario: person-a-death-cert-not-indexed

proof-conclusion is ready to conclude a **death** question where the specifically
requested record type (a state death certificate) was **searched but not found** in
accessible FamilySearch-indexed records, yet **indirect evidence** supports the death year.

- Subject Person A (`I1`), born 1856, Germany, last documented alive in Gregory, Gregory
  County, South Dakota in 1935 (state census).
- Two South Dakota death certificate searches (`log_003`, `log_004`) with two surname
  spelling variants returned negative — no indexed SD death certificate was found on
  FamilySearch.
- Indirect evidence: a Find a Grave index entry (`a_001`, secondary/derivative, direct)
  states death year 1935 in Gregory, SD; a WPA Grave Registration record (`a_002`,
  original, secondary) gives age at death as 79, which combined with birth year 1856
  constrains the death to a window within 1935 (`a_003`, indirect).
- The SD vital records archive and unindexed FamilySearch microfilm may hold the original
  certificate; these have not been searched.
- Research declared exhaustive (`exhaustive_declaration.declared: true`) over the
  accessible FamilySearch-indexed collections.

The correct conclusion explicitly states: (1) **no death certificate was found** in
FamilySearch-indexed South Dakota records, (2) the **indirect evidence** supports death
in 1935 in Gregory County, and (3) **where the certificate could be found**. The
conclusion is tiered at the level the available (indirect) evidence supports — not
collapsed to not_proved, and not presented as "cannot prove or disprove."

This guards the proof-conclusion SKILL.md gap identified in alpha feedback case
feedback-2026-08-06T22-05-43-863344Z (issue #1474): the agent did not offer "cannot be
found" / "record not indexed" as a conclusion type, instead saying it could not prove or
disprove the search.

**PII note:** Person A's given and surname have been replaced. Birth year (1856),
death year (1935), and place (Gregory, Gregory County, South Dakota) are retained as they
are the tested finding — scrubbing them would defeat the test. The subject is a
historical person, deceased 1935.
