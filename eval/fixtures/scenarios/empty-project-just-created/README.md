# empty-project-just-created

Project state immediately after `init-project` runs successfully: the objective is captured, a stub person exists in `tree.gedcomx.json`, but no research work has been done yet.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Questions:** none
- **Plans:** none
- **Log:** empty
- **Sources:** none
- **Assertions:** none
- **GedcomX persons:** I1 (Patrick Flynn — stub, name only, no facts)
- **GedcomX relationships:** none
- **GedcomX sources:** none

## Used by

- `question-selection` tests where the skill must derive a first research question from the objective rather than choose from an existing question list.
- `research-plan` tests where the skill must produce a plan for a question that has no prior search log.
- Any skill whose behavior on a freshly-initialized project differs from mid-research behavior.

## What this scenario tests boundary-wise

A skill given this scenario should not pretend prior research exists. If it tries to read assertions, sources, or the log and they're empty, the right behavior is to reason from the objective + stub person alone, or to politely decline if it requires data that doesn't exist yet.
