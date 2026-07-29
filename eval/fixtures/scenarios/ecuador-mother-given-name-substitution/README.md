# Scenario: ecuador-mother-given-name-substitution

Built for the **different-given-name = core-identifier conflict** case (person-evidence).

## State

- **Subject couple:** Santiago Gonzalez (`I1`) and his wife **Petra** Tumbaco (`I2`),
  of Guayaquil, Guayas, Ecuador, with one established daughter Maria Angela Gonzalez
  Tumbaco (`I3`, b. 1921) — so the family and the maternal surname **Tumbaco** are
  already fixed in the tree.
- **Candidate to evaluate:** assertion `a_001` (record_persona_id `MP1`) — the mother
  named in an Ecuadorian cemetery record for a possible additional son (Manuel de Jesus
  Gonzalez Tumbaco, d. 1985). The record names the mother **"Petita Tumbaco"**. Surname,
  gender, and family context align with `I2`; the **given name "Petita" differs from the
  tree's "Petra."** The datum is secondary/indirect, informant unknown (reported at the
  son's death registration ~70 years after birth).
- No `person_evidence` links yet — evaluating the mother match is the task.

## What it exercises

The person-evidence rule that a **different given name presented as the same person is a
core-identifier conflict**, not a name variant. The strong pulls (matching surname
Tumbaco, matching spouse Santiago, children carrying the compound surname Gonzalez
Tumbaco) tempt a `confident`/`probable` link, and `same_person` returns a plausible
score — but "Petita" is not a transcription, phonetic, or established diminutive of
"Petra." The skill must **not** dissolve the discrepancy by asserting a linguistic rule
("Petita is a standard diminutive of Petra") inline; it must cap confidence at
`speculative` (no-link in an autonomous run), surface the given-name conflict explicitly
in the `pe_` rationale, and route it to conflict-resolution / hypothesis-tracking — the
equivalence is established only by an **independent** corroborating source, not asserted.

Sibling of `norwegian-patronymic-conflict-link` (ut_020), where the core-identifier
conflict is a patronymic mismatch; here it is a different maternal given name. Regression
guards that must still link live in the transcription-variant tests (Flynn/Flinn) and the
cross-language edge case (Johannes/John) — those are the *same* name and must not be
caught by this rule.
