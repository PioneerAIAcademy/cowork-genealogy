# Validation Protocol

1. **Schema validation is automatic.** Writes go through the
   persistence tools (`research_append`, `tree_edit`, the merge tools),
   which validate every entry before persisting and write nothing on
   `{ ok: false, errors }`. There is no separate post-write
   `validate-schema` step — surface the returned errors and fix the
   input instead. (`validate-schema` remains available as a manual
   audit tool when you want to re-check an existing project.)

2. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.). It is not auto-triggered — you must
   invoke it explicitly.
