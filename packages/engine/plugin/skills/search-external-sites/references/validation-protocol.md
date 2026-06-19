# Validation Protocol

1. **Structural validation is automatic.** The persistence tools
   (`research_log_append`, `research_append`, `tree_edit`, the merge
   tools) validate the whole project *before* writing and persist
   nothing on `{ ok: false, errors }`. You do not run `validate-schema`
   after a tool write — if a call returns `{ ok: false }`, fix the
   inputs and call again. (`validate-schema` remains available as a
   manual audit of a project you did not just write through a tool.)

2. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.) — structural validation does not cover
   genealogical plausibility. It is not auto-triggered; invoke it
   explicitly.
