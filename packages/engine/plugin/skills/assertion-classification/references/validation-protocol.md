# Validation Protocol

The persistence tools (`research_append`, `tree_edit`, and the merge
tools) validate-before-persist: they check the document against the
published schema and write nothing on `{ ok: false, errors }`. So a
structural schema pass is no longer a separate step — surface any
returned errors instead of re-validating by hand.

**Invoke `check-warnings`** after writing assertions or person_evidence
entries. This checks for genealogical impossibilities (married before 12,
died after 120, child born after a parent's death, etc.) — plausibility,
not structure, which the persistence step does not cover. It is not
auto-triggered; you must invoke it explicitly.
