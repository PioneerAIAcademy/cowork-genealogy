# person-less-project

Project state right after `project_create` with no `personId`: the researcher's request is the objective, there is no subject and the tree is empty. Every activity with no person in it (a page read, a record set's names, a surname survey) runs in this state.

- **Objective:** Research request with no person in it
- **Subject persons:** none
- **Questions, plans, log, sources, assertions:** none
- **GedcomX persons, relationships, sources:** none

A `questions` append is refused here: research on a person starts a new project from a FamilySearch person ID.

## Used by

- `survey-surname` and `search-images` tests that run in a project with no person.
