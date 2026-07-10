# Scenario: blyeberg-first-plan

Danish patronymic parentage question with **no plan yet** — the state a
research project is in immediately after question-selection writes the
first question.

- **Subject:** Mikkel Nielsen Blyeberg (`I1`), born 20 Aug 1779,
  Stagstrup Sogn, Thisted Amt, Denmark. Only his birth is in the tree —
  no parents, no relationships, no sources.
- **q_001** (`in_progress`): who was his father? The patronymic
  *Nielsen* implies a father named Niels, but nothing is documented.
- `plans` is empty: research-plan should create the **first** plan
  (Add-new path, validator tag `research-plan-new-plan-for-q-001`).

The point of this scenario: for a **male subject in 1789+ Denmark**, a
sound parentage plan must include the **military levy rolls
(lægdsruller)** — boys are enrolled under the father's name, so the
roll is direct parentage evidence for a son — alongside the parish
registers and the parents' marriage. The companion MCP fixtures
(collections/wiki/volume searches for Thisted/Denmark) surface the
lægdsruller collection and its wiki description, mirroring what live
FamilySearch returns for this jurisdiction.

Derived from the `mikkel-blyeberg-father` e2e fixture (issue #574),
whose diagnosis found the levy rolls were never planned.
