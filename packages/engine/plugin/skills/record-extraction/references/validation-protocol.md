# Validation Protocol

After writing to `research.json` or `tree.gedcomx.json`, follow these steps:

1. **Structural validation is handled by the write tools.**
   `research_append` and `research_log_append` validate the whole
   project before persisting and write nothing on `{ ok: false,
   errors }` — so there is no separate `validate-schema` pass for the
   entries they write. Surface any returned errors and correct the
   offending entry. (`validate-schema` remains available as a manual
   audit when you want to re-check the project as a whole.)

2. **Invoke `check-warnings`** if you added assertions or
   person_evidence entries. This checks for genealogical
   impossibilities (married before 12, died after 120, child born
   after parent's death, etc.). It is NOT auto-triggered — you must
   invoke it explicitly, and it is not structural validation, so the
   write tools do not run it.

3. **Internal consistency check** (BCG Standard 35): Before
   finalizing, scan the extracted assertions for contradictions
   within the same record (e.g., age says 45 but birth year
   implies 43). Note discrepancies in assertions rather than
   silently resolving them — resolution is a downstream skill.
