# first-plan-fan-production-shape

`first-plan-fan-already-sourced` with **one** change: the fact→source ref is removed from
Patrick Sheahan's (I2) 1875 Residence fact. S1 stays in the tree's top-level `sources[]`,
and the fact keeps its `date`, `place` and `value`.

## Why it exists

This is the shape of a real FamilySearch import. Simplified GedcomX has no person-level
source field (`TREE_PERSON_FIELDS` = `id, ark, living, gender, names, facts`), so the only
source↔person link runs through a fact-level `sources` ref — and real imports do not write
them:

- **3 of 136** `eval/tests/e2e/*/starting-tree.gedcomx.json` carry any (55 of 4,182 facts).
- **62 of 99** hand-authored `eval/fixtures/scenarios/*/tree.gedcomx.json` do.

Every other research-plan scenario sits on the hand-authored side, so before this one the
suite could not see a survey rule that works only when the ref is present. Issue #2208;
measured 2026-09-22.

## Notes for reviewers

The point of the scenario is that the planner has everything it needs **locally** — the
1875 date, the Schuylkill County place, and the value `"Purchased land, Deed Book 42
p. 118"` — and must state that content in the plan rationale without being handed a source
ref to notice it by. A response that names Patrick without naming what the fact records is
the failure this guards against.

Do not "fix" this scenario by re-adding the fact-level source ref. That is the variable
under test.
