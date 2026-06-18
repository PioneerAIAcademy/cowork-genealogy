# empty-folder-no-project

An intentionally empty project folder: **no `research.json` and no
`tree.gedcomx.json`**. The harness copies only those two files when a
scenario provides them (see `eval/harness/harness/workspace.py`), so a
run against this scenario starts in a workspace with no project state at
all — the situation a user is in before any project has been created.

Used by project-status negative test `ut_project_status_009`: when the
user opens such a folder and asks "where are we?", the correct routing
is to **init-project** (start a new project), not project-status.
project-status's own description says: "Do NOT use when no research.json
exists in the folder (use init-project instead)."

This folder is deliberately README-only. Do not add `research.json` or
`tree.gedcomx.json` — their absence *is* the fixture.
