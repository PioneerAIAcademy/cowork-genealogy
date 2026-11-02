# plan-reads-question-person-profile

A parentage question about a relative who was imported with the subject. Synthetic ids
(`ZZKR-*`); the shape is alpha report #3244 (issue #2208).

## Why it exists

`project_create` imports the subject and her relatives, but not the relatives' own
parents. So the project tree has Thomas Kerrigan (I2) with no parents, while FamilySearch
already proposes Patrick Kerrigan and Mary Gallagher and holds a baptism naming both. A plan
written from the project tree alone searches for them from scratch.

Every person carries an `ark` (`ark:/61903/4:1:<PID>`), the shape `project_create` writes.
Only this scenario and `plan-subject-from-tree` do, so they are the only two where the
profile rule can fire: here for a relative (the read is required), there for the subject
(the read is forbidden).

## Notes for reviewers

The two `person_read` fixtures are `person-read-kerrigan-proposed-parents` (the father —
the read the test requires) and `person-read-kerrigan-subject` (the subject; a read of her is
forbidden by the agent and graded by `ut_research_plan_subj`, and the fixture is loaded so
such a read is served rather than failing). Do not add Thomas's parents to `tree.gedcomx.json`;
their absence is the variable under test.
