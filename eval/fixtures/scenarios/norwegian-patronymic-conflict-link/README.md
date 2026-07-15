# Scenario: norwegian-patronymic-conflict-link

Built for the **patronymic-mismatch = core-identifier conflict** case (person-evidence).

## State

- **Subject:** Anders Hansen (`I1`), b. ~1868 Ringsaker, Hedmark, Norway — patronymic
  **Hansen** (son of Hans), established in the tree by his father Hans Olsen (`I2`,
  `ParentChild` R1 from the 1868 christening).
- **Candidate to evaluate:** assertions `a_001`/`a_002` (record_persona_id `CP1`) from
  an 1875 Norway census entry for **"Anders Pedersen"**, age 7 (~1868), same district.
  Given name + age + place align with the subject — but the patronymic is **Pedersen**
  (son of Peder), not Hansen.
- No `person_evidence` links yet — evaluating the match is the task.

## What it exercises

The person-evidence rule that a **patronymic mismatch is a core-identifier conflict**
that caps confidence and must be **recorded, not rationalized**. `same_person` returns
a high score (given/age/place align), but in a patronymic naming system a differing
patronymic names a *different father* — so it is a qualitative conflict, not a spelling
variant. The skill must NOT create a `confident`/`probable` link, must cap confidence at
`speculative` (and surface the conflict / ask), and must state the Pedersen-vs-Hansen
patronymic mismatch explicitly rather than treating it as a variant.

Sibling of `high-score-conflict-not-auto-linked` (ut_012), where the conflict is a
contradicting birthplace; here the conflict is a patronymic mismatch, which the skill
must name as such.
