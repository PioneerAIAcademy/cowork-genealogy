# first-plan-fan-production-shape

`first-plan-fan-already-sourced` in the tree shape `project_create` writes today
(#3066, #3140), issue #2208.

## What differs from the bpx scenario

- Every fact refs the blanket `S1` "FamilySearch Family Tree" source (`quality: 1`).
- Patrick Sheahan's (I2) deed is `S2`, referenced from `persons[I2].sources` — a
  person-level attachment — and from no fact.
- Patrick's 1875 Residence fact carries only its date and place. What he bought, and
  where it is recorded, is in `S2` alone.

## Notes for reviewers

The point is that the deed's content reaches the plan only if the survey reads a
relative's person-level attachments. A response that says Patrick lived in Schuylkill
County in 1875 without saying what `S2` records is the failure this guards against.

No person carries an `ark` (production trees do). That is deliberate: with an `ark`,
the profile-read step would fire on Michael and need its own `person_read` fixture.
`ut_research_plan_prof` covers that step.
