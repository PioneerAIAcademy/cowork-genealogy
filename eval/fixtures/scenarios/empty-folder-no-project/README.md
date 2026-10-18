# empty-folder-no-project

An intentionally empty project folder: **no `research.json` and no
`tree.gedcomx.json`**. The harness copies only those two files when a
scenario provides them (see `eval/harness/harness/workspace.py`), so a
run against this scenario starts in a workspace with no project state at
all — the situation a user is in before any project has been created.

A reusable "no project yet" fixture: when the user opens such a folder and
asks "where are we?" or similar, the correct behavior is to recognize there
is no project to summarize and **redirect the user to init-project** without
fabricating a status.

This folder is deliberately README-only. Do not add `research.json` or
`tree.gedcomx.json` — their absence *is* the fixture.
