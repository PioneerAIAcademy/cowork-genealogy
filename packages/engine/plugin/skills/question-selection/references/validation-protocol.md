# Validation Protocol

The structured write tools (`research_append`, `research_log_append`,
`tree_edit`, the merge tools) **validate the project before they
persist** and write nothing on a validation failure — so there is no
separate post-write schema-validation step. If a write tool returns
`{ ok: false, errors }`, surface the errors and fix the entry; do not
retry the same payload blindly.

Genealogical plausibility is a separate concern from schema validity:

- **Invoke `check-warnings`** if you added assertions or
  person_evidence entries. This checks for genealogical
  impossibilities (married before 12, died after 120, child born
  after parent's death, etc.). It is not auto-triggered — you must
  invoke it explicitly.
