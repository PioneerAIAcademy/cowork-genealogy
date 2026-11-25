Cornelius Driscoll, Margaret Hayes and their ids are invented test fixtures,
not real FamilySearch profiles. Their ids (`GJ72-9WD`, `GJ72-9WF`) have the
shape of FamilySearch ids on purpose. No call in this run reaches FamilySearch
or the wiki: those answers come from test fixtures. Tools that read or write
the project's own files run for real against a temporary copy of it.

The project holds no research yet: every `research.json` section after
`project` is empty. The sources attached to the profile reach the run only
through those test fixtures; the project's own files carry none of them.
