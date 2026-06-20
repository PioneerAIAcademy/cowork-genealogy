# Validation Protocol

The persistence tools (`research_append`, the merge / `tree_edit`
tools) validate the whole project before writing and persist nothing
on `{ ok: false, errors }` — a successful write is already
schema-valid, so no separate post-write schema validation is needed.

After writing, still:

1. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.) — plausibility, not structure, so the
   write tools do not cover it.

This is not auto-triggered — you must invoke it explicitly.
