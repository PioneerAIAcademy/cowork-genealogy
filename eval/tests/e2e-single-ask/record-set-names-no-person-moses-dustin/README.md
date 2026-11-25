# record-set-names-no-person-moses-dustin

**Ask:** "Identify all soldiers in Captain Moses Dustin's Company."

**Expected owner:** `search-images`. **Expected save:** a `log` entry. **Required:** `project_context`,
`project_create`. **Forbidden:** `person_search`, `tree_gaps`.

## Why it exists

Issue #4686 (lead, 2026-11-19): every activity starts a project, including one with no person in it. The
message names a record set and no person, so the router calls `project_create` with the message as the
objective and no `personId`, then hands the agent that `projectPath`; no read or search comes first, and
init-project is not spawned. `birth-no-pid-marie-brigard` is the other half: a named person with no ID still
creates nothing.

## Starting state

None: an empty folder, the shape of a first message.

## Expected result today

Not yet run. It needs the router and `search-images` edits of the same issue, and a paid run.
