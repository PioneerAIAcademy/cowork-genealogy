# project-before-read-stephen-mcelwee

**Ask:** "Stephen McElwee KHCM-61R has 5 children listed on his FS profile. Eliza is born about when he dies. Does she belong?"

**Expected owner:** `init-project`. **Expected save:** a `log` entry from `source_evaluation`. **Required:** `project_context`, `project_create`.

## Where it came from

Feedback #4710, quoted on issue #4686 (2026-11-19). The main thread called `project_context`, got `no_project`, never loaded the research skill and spawned source-evaluation with no `projectPath`. That agent ran `person_read` twice, `person_quality` and `record_read`, answered in chat and saved nothing. The lead asked for this fixture on the issue, with the message verbatim, in an empty folder.

None of the other source-evaluation fixtures has this shape: `evaluate-sources-moses-watrous` and `review-sources-george-watrous` both start with a project.

## What it checks

The message names a person with an ID, so the router starts `init-project`, whose `project_create` creates the project before any `person_read` or `record_read`. The server's gate refuses those reads with no project, so the order is enforced by the tool as well as asked for in prose. The fixture has no ordering key, so the order is stated in `must_not` for the grade.

## Starting state

None: an empty folder, the shape of a first message.

## Expected result today

Not yet run; it needs a paid single-ask run.
