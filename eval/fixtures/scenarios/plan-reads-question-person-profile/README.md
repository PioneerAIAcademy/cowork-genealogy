# plan-reads-question-person-profile

A parentage question about a relative who was imported with the subject. Synthetic ids
(`ZZKR-*`); the shape is alpha report #3244 (issue #2208).

## Why it exists

`project_create` imports the subject and her relatives, but not the relatives' own
parents. So the project tree has Thomas Kerrigan (I2) with no parents, while FamilySearch
already proposes Patrick Kerrigan and Mary Gallagher and holds a baptism naming both. A plan
written from the project tree alone searches for them from scratch.

Every person carries an `ark` (`ark:/61903/4:1:<PID>`), the shape `project_create` writes.
No other research-plan scenario does, so this is the only one where the profile re-read
can fire.

## Notes for reviewers

The two `person_read` fixtures are `person-read-kerrigan-proposed-parents` (the father —
the read the test requires) and `person-read-kerrigan-subject` (registered only so an extra
read of the subject does not fail). Do not add Thomas's parents to `tree.gedcomx.json`;
their absence is the variable under test.
