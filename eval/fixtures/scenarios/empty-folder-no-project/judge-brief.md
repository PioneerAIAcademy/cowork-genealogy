The run's folder starts with no project in it: there is no `research.json` and
no `tree.gedcomx.json`. That empty start is the scenario, on purpose, not lost
data.

No call in this run reaches FamilySearch or the wiki: those answers come from
test fixtures. Tools that create, read or write a project's files run for real
in the run's temporary folder.
