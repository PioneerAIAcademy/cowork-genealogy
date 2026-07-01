# empty-folder-no-project

An intentionally empty project folder: **no `research.json` and no
`tree.gedcomx.json`**. The harness copies only those two files when a
scenario provides them (see `eval/harness/harness/workspace.py`), so a
run against this scenario starts in a workspace with no project state at
all — the situation a user is in before any project has been created.

Used by project-status test `ut_project_status_009` (positive): when the
user opens such a folder and asks "where are we?", that phrasing matches
project-status's trigger words, so project-status fires — and the correct
behavior is for it to recognize there is no project to summarize and
**redirect the user to init-project** without fabricating a status. The
test is framed positive (not negative) because description-routing cannot
see that the folder is empty, so non-activation isn't the contract; the
graceful self-detection and hand-off is. See the empty-folder exception
in `eval/tests/unit/project-status/rubric.md`.

This folder is deliberately README-only. Do not add `research.json` or
`tree.gedcomx.json` — their absence *is* the fixture.
