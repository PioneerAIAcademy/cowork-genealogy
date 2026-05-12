# Validation Protocol

After writing to `research.json` or `tree.gedcomx.json`, follow these steps:

1. **Invoke `validate-schema`** to verify both files conform to the
   published schemas. If validation fails, fix the errors before
   proceeding.

2. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.).

These are not auto-triggered — you must invoke them explicitly.
