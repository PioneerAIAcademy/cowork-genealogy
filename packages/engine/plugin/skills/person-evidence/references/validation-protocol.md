# Validation Protocol

The persistence tools (`research_append`, `tree_edit`) validate
the project schema *before* they persist — they write nothing on
`{ ok: false, errors }`. So a separate post-write schema validation
pass is no longer needed; surface those errors to the user instead of
retrying blindly.

One check still runs separately, because it is about genealogical
plausibility rather than structure:

- **Invoke `check-warnings`** after you add person_evidence entries
  or stub persons. This checks for genealogical impossibilities
  (married before 12, died after 120, child born after parent's death,
  etc.).

It is not auto-triggered — you must invoke it explicitly.
